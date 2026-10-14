import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  OverlaysFileSchema,
  type LiveEvent,
  type OverlaysConfig,
  type OverlaysFile,
  type OverlaysState,
  type TimerState,
  type TimerStatus,
  type WinsState,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor de contadores de los overlays (ADR 0011): **timer** y **wins**.
 *
 * Vive en el sidecar y es la única fuente de verdad: la UI y los overlays solo
 * lo leen (por el canal WS `overlays`) y lo controlan a través de él. El timer
 * guarda la HORA DE FIN, no los segundos restantes, para que cualquier overlay
 * dibuje la cuenta sola y para sobrevivir a un reinicio.
 *
 * Eventos que emite:
 *  - `state` (OverlaysState)   cada vez que algo cambia.
 *  - `timer-expired` (string[]) el timer llegó a 0; trae los ids de Acciones de
 *                               "al expirar" para que quien lo use las ejecute.
 *  - `wins-goal` (WinsState)    el conteo alcanzó la meta (una vez por cruce).
 *  - `log` ({level, message, details?}).
 */

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export type PersistedOverlays = OverlaysFile;

export interface OverlaysStorePort {
  load(): PersistedOverlays;
  save(data: PersistedOverlays): Promise<void>;
}

export function defaultOverlaysFilePath(): string {
  return join(appDataDir(), "overlays.json");
}

export class OverlaysStore implements OverlaysStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedOverlays {
    const defaults = OverlaysFileSchema.parse({});
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      }
      return defaults;
    }
    if (raw.trim() === "") return defaults;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.filePath}; se ignora: ${(err as Error).message}`);
      return defaults;
    }
    const parsed = OverlaysFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("overlays.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename) para no dejar un JSON a medias. */
  async save(data: PersistedOverlays): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const HEARTBEAT_MS = 5_000;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface OverlayCountersOptions {
  store: OverlaysStorePort;
}

export class OverlayCounters extends EventEmitter {
  private config: OverlaysConfig;
  private status: TimerStatus = "idle";
  private remainingMs = 0;
  private endsAt: number | undefined;
  private wins: WinsState = { title: "Win Game", goal: 10, count: 0 };
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** Monedas ya contadas de un combo en curso (usuario|regalo → monedas acumuladas). */
  private coinStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private store: OverlaysStorePort;

  constructor(opts: OverlayCountersOptions) {
    super();
    this.store = opts.store;
    const persisted = this.store.load();
    this.config = persisted.config;
    if (persisted.wins) this.wins = persisted.wins;
    this.restoreTimer(persisted);
  }

  // ---- Estado -------------------------------------------------------------

  private startMs(): number {
    return this.clampMs(this.config.timer.startSeconds * 1000);
  }

  private clampMs(ms: number): number {
    const max = this.config.timer.maxSeconds * 1000;
    const v = Math.max(0, Math.round(ms));
    return max > 0 ? Math.min(v, max) : v;
  }

  private currentRemainingMs(): number {
    if (this.status === "running" && this.endsAt !== undefined) return Math.max(0, this.endsAt - Date.now());
    return this.remainingMs;
  }

  private timerState(): TimerState {
    const timer: TimerState = { status: this.status, remainingMs: this.currentRemainingMs() };
    if (this.status === "running" && this.endsAt !== undefined) timer.endsAt = this.endsAt;
    return timer;
  }

  getState(): OverlaysState {
    return { timer: this.timerState(), wins: { ...this.wins }, serverNow: Date.now() };
  }

  getConfig(): OverlaysConfig {
    return this.config;
  }

  private restoreTimer(p: PersistedOverlays) {
    const t = p.timer;
    if (!t || !this.config.timer.rememberOnClose) {
      this.status = "idle";
      this.remainingMs = this.startMs();
      return;
    }
    if (t.status === "running" && t.endsAt !== undefined) {
      // Se cerró la app con el timer corriendo: vuelve en PAUSA con lo que faltaba al guardar.
      const left = Math.max(0, t.endsAt - (p.savedAt ?? Date.now()));
      this.status = left > 0 ? "paused" : "finished";
      this.remainingMs = left;
      return;
    }
    this.status = t.status === "running" ? "paused" : t.status;
    this.remainingMs = t.remainingMs;
  }

  private changed() {
    this.emit("state", this.getState());
    this.persist();
  }

  // ---- Persistencia -------------------------------------------------------

  private snapshot(): PersistedOverlays {
    return { config: this.config, timer: this.timerState(), wins: { ...this.wins }, savedAt: Date.now() };
  }

  /** Una escritura a la vez: si llegan cambios mientras se guarda, se guarda otra vez al terminar. */
  private persist() {
    if (this.saving) {
      this.dirty = true;
      return;
    }
    this.saving = true;
    this.store
      .save(this.snapshot())
      .catch((err) =>
        this.emit("log", { level: "error", message: "No se pudo guardar overlays.json", details: err }),
      )
      .finally(() => {
        this.saving = false;
        if (this.dirty) {
          this.dirty = false;
          this.persist();
        }
      });
  }

  // ---- Timer --------------------------------------------------------------

  private clearExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleExpiry() {
    this.clearExpiry();
    if (this.status !== "running" || this.endsAt === undefined) return;
    const arm = () => {
      const left = this.currentRemainingMs();
      if (left <= 0) {
        this.finish();
        return;
      }
      this.expiryTimer = setTimeout(arm, Math.min(left, MAX_TIMEOUT_MS));
      this.expiryTimer.unref?.();
    };
    arm();
    if (this.status === "running") {
      // Guarda la hora cada tanto: así, tras un cierre brusco, se sabe cuánto faltaba.
      this.heartbeat = setInterval(() => this.persist(), HEARTBEAT_MS);
      this.heartbeat.unref?.();
    }
  }

  private finish() {
    this.clearExpiry();
    this.status = "finished";
    this.remainingMs = 0;
    this.endsAt = undefined;
    this.changed();
    this.emit("timer-expired", [...this.config.timer.onExpireAccionIds]);
  }

  timerStart() {
    if (this.status === "running") return;
    const rem =
      this.status === "paused" || (this.status === "idle" && this.remainingMs > 0)
        ? this.clampMs(this.remainingMs)
        : this.startMs();
    if (rem <= 0) return;
    this.status = "running";
    this.remainingMs = rem;
    this.endsAt = Date.now() + rem;
    this.scheduleExpiry();
    this.changed();
  }

  timerPause() {
    if (this.status !== "running") return;
    this.remainingMs = this.currentRemainingMs();
    this.status = "paused";
    this.endsAt = undefined;
    this.clearExpiry();
    this.changed();
  }

  /** Vuelve al valor inicial, detenido. */
  timerReset() {
    this.clearExpiry();
    this.status = "idle";
    this.remainingMs = this.startMs();
    this.endsAt = undefined;
    this.changed();
  }

  /** Detiene el timer en 0. */
  timerStop() {
    this.clearExpiry();
    this.status = "idle";
    this.remainingMs = 0;
    this.endsAt = undefined;
    this.changed();
  }

  /**
   * Suma (o resta, si es negativo) segundos. Los cambios automáticos (eventos,
   * segundos por tipo) solo cuentan con el timer corriendo; los manuales
   * (botones +/−) también con el timer en pausa o detenido.
   */
  timerAdd(seconds: number, opts: { manual?: boolean } = {}) {
    if (!isNum(seconds) || seconds === 0) return;
    const delta = Math.round(seconds * 1000);
    if (this.status === "running") {
      const next = this.clampMs(this.currentRemainingMs() + delta);
      if (next <= 0) {
        this.finish();
        return;
      }
      this.endsAt = Date.now() + next;
      this.scheduleExpiry();
      this.changed();
      return;
    }
    if (!opts.manual) return;
    if (this.status === "finished") this.status = "idle";
    this.remainingMs = this.clampMs(this.remainingMs + delta);
    this.changed();
  }

  /** Fija el tiempo restante (también con el timer corriendo). */
  timerSet(seconds: number) {
    if (!isNum(seconds)) return;
    const ms = this.clampMs(Math.max(0, seconds) * 1000);
    if (this.status === "running") {
      if (ms <= 0) {
        this.finish();
        return;
      }
      this.endsAt = Date.now() + ms;
      this.scheduleExpiry();
      this.changed();
      return;
    }
    if (this.status === "finished") this.status = "idle";
    this.remainingMs = ms;
    this.changed();
  }

  // ---- Segundos por tipo de interacción -----------------------------------

  /** Aplica los "segundos por tipo" de la configuración a un LiveEvent. */
  handleLiveEvent(evt: LiveEvent) {
    const per = this.config.timer.perType;
    let seconds = 0;
    switch (evt.event) {
      case "gift": {
        // `coins` es el acumulado del combo: se cuenta solo lo nuevo de cada mensaje.
        const key = `${handleKey(evt.username)}|${evt.giftId ?? evt.giftName ?? "?"}`;
        const total = isNum(evt.coins) ? evt.coins : 0;
        const delta = Math.max(0, total - (this.coinStreaks.get(key) ?? 0));
        if (evt.repeatEnd === false) this.coinStreaks.set(key, total);
        else this.coinStreaks.delete(key);
        seconds = delta * per.coin;
        break;
      }
      case "subscribe":
        seconds = per.subscribe;
        break;
      case "follow":
        seconds = per.follow;
        break;
      case "share":
        seconds = per.share;
        break;
      case "like":
        seconds = (evt.likeCount ?? 1) * per.like;
        break;
      case "comment":
        seconds = per.chat;
        break;
      default:
        return;
    }
    if (seconds === 0) return;
    const mult = this.config.timer.multiplier;
    const total = seconds * (mult.active ? mult.value : 1);
    if (this.status === "running") {
      this.timerAdd(total);
    } else if (total > 0 && this.config.timer.autoStart && (this.status === "idle" || this.status === "finished")) {
      this.timerAutoStart(total);
    }
    // En pausa no suma: pausar es una decisión del streamer.
  }

  /**
   * La primera interacción que suma tiempo, con el timer detenido o en 0, lo
   * inicia sola: cuenta atrás desde lo que se ve (0 tras terminar, o el tiempo
   * inicial si aún no se había arrancado) más lo que acaba de sumar.
   */
  private timerAutoStart(seconds: number) {
    const base = this.status === "idle" ? this.remainingMs : 0;
    const rem = this.clampMs(base + Math.round(seconds * 1000));
    if (rem <= 0) return;
    this.status = "running";
    this.remainingMs = rem;
    this.endsAt = Date.now() + rem;
    this.scheduleExpiry();
    this.changed();
  }

  /** Nueva sesión de LIVE: se olvidan los combos en curso. */
  resetSession() {
    this.coinStreaks.clear();
  }

  // ---- Wins ---------------------------------------------------------------

  private setCount(next: number) {
    const before = this.wins.count;
    this.wins = { ...this.wins, count: Math.trunc(next) };
    this.changed();
    const { goal, count } = this.wins;
    if (goal > 0 && before < goal && count >= goal) this.emit("wins-goal", { ...this.wins });
  }

  winsAdd(amount: number) {
    if (!isNum(amount)) return;
    this.setCount(this.wins.count + Math.trunc(amount));
  }

  winsSet(count: number) {
    if (!isNum(count)) return;
    this.setCount(count);
  }

  winsReset() {
    this.setCount(0);
  }

  winsSetGoal(goal: number) {
    if (!isNum(goal)) return;
    this.wins = { ...this.wins, goal: Math.max(0, Math.floor(goal)) };
    this.changed();
  }

  winsSetTitle(title: string) {
    this.wins = { ...this.wins, title: String(title) };
    this.changed();
  }

  // ---- Configuración ------------------------------------------------------

  setConfig(config: OverlaysConfig) {
    const prevStartMs = this.startMs();
    this.config = config;
    // Un timer que nadie tocó (idle con el valor inicial viejo) adopta el nuevo.
    if (this.status === "idle" && this.remainingMs === prevStartMs) this.remainingMs = this.startMs();
    this.changed();
  }

  // ---- Comandos internos (acciones `app.*`) -------------------------------

  applyAppCommand(id: string, params: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
    const num = (name: string): number | undefined => (isNum(params[name]) ? (params[name] as number) : undefined);
    const need = (name: string): { ok: false; error: string } => ({
      ok: false,
      error: `${id} necesita el parámetro numérico "${name}"`,
    });
    switch (id) {
      case "app.timer.start":
        this.timerStart();
        return { ok: true };
      case "app.timer.pause":
        this.timerPause();
        return { ok: true };
      case "app.timer.reset":
        this.timerReset();
        return { ok: true };
      case "app.timer.stop":
        this.timerStop();
        return { ok: true };
      case "app.timer.add": {
        const s = num("seconds");
        if (s === undefined) return need("seconds");
        this.timerAdd(s);
        return { ok: true };
      }
      case "app.timer.set": {
        const s = num("seconds");
        if (s === undefined) return need("seconds");
        this.timerSet(s);
        return { ok: true };
      }
      case "app.wins.add": {
        const n = num("amount");
        if (n === undefined) return need("amount");
        this.winsAdd(n);
        return { ok: true };
      }
      case "app.wins.remove": {
        const n = num("amount");
        if (n === undefined) return need("amount");
        this.winsAdd(-Math.abs(n)); // "quitar" siempre resta, venga el número con el signo que venga
        return { ok: true };
      }
      case "app.wins.set": {
        const n = num("count");
        if (n === undefined) return need("count");
        this.winsSet(n);
        return { ok: true };
      }
      case "app.wins.reset":
        this.winsReset();
        return { ok: true };
      default:
        return { ok: false, error: `comando interno desconocido: ${id}` };
    }
  }

  /** Para el cierre del proceso: corta los temporizadores y guarda una última vez. */
  dispose() {
    this.clearExpiry();
    this.persist();
  }
}
