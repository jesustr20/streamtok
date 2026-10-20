import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dayKey, TopsFileSchema, type LiveEvent, type TopConfig, type TopPerson, type TopRuntime, type TopState } from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor de tops (ADR 0017). Suma por persona los eventos que ya existen (regalos, likes, comentarios,
 * compartidos) y guarda el ranking, para los overlays `/overlay/top/<id>`.
 *
 * Eventos: `state` (cambió algo: configuración o ranking), `log` ({level, message}).
 */

export type PersistedTops = ReturnType<typeof TopsFileSchema.parse>;

export interface TopsStorePort {
  load(): PersistedTops;
  save(data: PersistedTops): Promise<void>;
}

export function defaultTopsFilePath(): string {
  return join(appDataDir(), "tops.json");
}

export class TopsStore implements TopsStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedTops {
    const defaults = TopsFileSchema.parse({});
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
    const parsed = TopsFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("tops.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: PersistedTops): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, this.filePath);
  }
}

/** Ranking en memoria de un top. */
interface Acc {
  people: Map<string, TopPerson>;
  day: string;
  updatedAt: number;
}

const MAX_PEOPLE = 300; // se recorta a los mejores cuando pasa del doble
const PERSIST_PEOPLE = 100;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const byScore = (a: TopPerson, b: TopPerson) => b.score - a.score;
const toPerson = (p: TopPerson): TopPerson => ({ handle: p.handle, name: p.name, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), score: p.score });

function add(map: Map<string, TopPerson>, handle: string, name: string, avatarUrl: string | undefined, delta: number): void {
  const cur = map.get(handle);
  if (cur) {
    cur.score += delta;
    cur.name = name;
    if (avatarUrl) cur.avatarUrl = avatarUrl;
    return;
  }
  map.set(handle, { handle, name, ...(avatarUrl ? { avatarUrl } : {}), score: delta });
  if (map.size > MAX_PEOPLE * 2) {
    const best = [...map.values()].sort(byScore).slice(0, MAX_PEOPLE);
    map.clear();
    for (const p of best) map.set(p.handle, p);
  }
}

export interface TopsEngineOptions {
  store: TopsStorePort;
  /** rankings que se crean la primera vez (uno que borres no reaparece) */
  presets?: TopConfig[];
  /** reloj (para pruebas) */
  now?: () => Date;
}

export class TopsEngine extends EventEmitter {
  private configs: TopConfig[];
  private seededIds: string[];
  private accs = new Map<string, Acc>();
  /** acumulados del combo en curso, para sumar solo lo nuevo de cada mensaje */
  private coinStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private idle: Promise<void> = Promise.resolve();
  private store: TopsStorePort;
  private now: () => Date;

  constructor(opts: TopsEngineOptions) {
    super();
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
    const loaded = this.store.load();
    this.configs = loaded.configs;
    this.seededIds = [...loaded.seededIds];
    for (const [id, rt] of Object.entries(loaded.runtime)) this.accs.set(id, this.fromRuntime(rt));
    let added = false;
    for (const config of opts.presets ?? []) {
      if (this.seededIds.includes(config.id)) continue;
      this.seededIds.push(config.id);
      added = true;
      if (!this.configs.some((c) => c.id === config.id)) this.configs.push(config);
    }
    if (added) this.persist();
  }

  getConfigs(): TopConfig[] {
    return this.configs;
  }

  getStates(): TopState[] {
    this.rollover();
    return this.configs.map((c) => this.snapshot(c));
  }

  getState(id: string): TopState | undefined {
    this.rollover();
    const config = this.configs.find((c) => c.id === id);
    return config ? this.snapshot(config) : undefined;
  }

  save(config: TopConfig): void {
    const i = this.configs.findIndex((c) => c.id === config.id);
    if (i === -1) this.configs.push(config);
    else {
      const metricChanged = this.configs[i].metric !== config.metric || this.configs[i].period !== config.period;
      this.configs[i] = config;
      // otra cosa que contar (o otro período) no tiene sentido sumada a lo anterior
      if (metricChanged) this.accs.set(config.id, this.emptyAcc());
    }
    this.changed();
  }

  /** Ranking a cero. */
  reset(id: string): void {
    if (!this.configs.some((c) => c.id === id)) return;
    const acc = this.emptyAcc();
    acc.updatedAt = this.now().getTime();
    this.accs.set(id, acc);
    this.changed();
  }

  /** Botón "Iniciar test": una persona de prueba suma `amount`, solo en este top. */
  test(id: string, name: string, amount: number): void {
    if (!this.configs.some((c) => c.id === id) || !isNum(amount) || amount < 1) return;
    this.rollover();
    const acc = this.acc(id);
    add(acc.people, `@prueba-${name.toLowerCase()}`, name, undefined, amount);
    acc.updatedAt = this.now().getTime();
    this.changed();
  }

  handleLiveEvent(evt: LiveEvent): void {
    if (this.configs.length === 0) return;
    this.rollover();
    const handle = handleKey(evt.username);
    const name = evt.nickname?.trim() || evt.username.replace(/^@/, "");
    let coins = 0;
    if (evt.event === "gift") {
      // `coins` es el acumulado del combo: se cuenta solo lo nuevo.
      const key = `${handle}|${evt.giftId ?? evt.giftName ?? "?"}`;
      const total = isNum(evt.coins) ? evt.coins : 0;
      coins = Math.max(0, total - (this.coinStreaks.get(key) ?? 0));
      if (evt.repeatEnd === false) this.coinStreaks.set(key, total);
      else this.coinStreaks.delete(key);
    }
    let touched = false;
    for (const config of this.configs) {
      let value = 0;
      if (config.metric === "coins") value = evt.event === "gift" ? coins : 0;
      else if (config.metric === "likes") value = evt.event === "like" ? (isNum(evt.likeCount) ? evt.likeCount : 1) : 0;
      else if (config.metric === "comments") value = evt.event === "comment" ? 1 : 0;
      else if (config.metric === "shares") value = evt.event === "share" ? 1 : 0;
      // "trivia" no viene de eventos del LIVE: lo suma `credit`
      if (value <= 0) continue;
      const acc = this.acc(config.id);
      add(acc.people, handle, name, evt.avatarUrl, value);
      acc.updatedAt = this.now().getTime();
      touched = true;
    }
    if (touched) this.changed();
  }

  /** Suma a una persona en los rankings que cuentan `metric` (lo usa la trivia del agente para el Top Trivia). */
  credit(metric: TopConfig["metric"], handle: string, name: string, avatarUrl: string | undefined, amount: number): void {
    if (!isNum(amount) || amount <= 0) return;
    this.rollover();
    let touched = false;
    for (const config of this.configs) {
      if (config.metric !== metric) continue;
      const acc = this.acc(config.id);
      add(acc.people, handleKey(handle), name, avatarUrl, amount);
      acc.updatedAt = this.now().getTime();
      touched = true;
    }
    if (touched) this.changed();
  }

  /** Nuevo LIVE: los rankings "de la sesión" empiezan de cero; los "del día" siguen. */
  resetSession(): void {
    this.coinStreaks.clear();
    let touched = false;
    for (const c of this.configs) {
      if (c.period !== "session") continue;
      const acc = this.acc(c.id);
      if (acc.people.size === 0) continue;
      acc.people.clear();
      acc.updatedAt = this.now().getTime();
      touched = true;
    }
    if (touched) this.changed();
  }

  /** Revisa si cambió el día (para los rankings "del día") y avisa si hubo que vaciarlos. Se llama cada minuto. */
  checkDay(): void {
    if (this.rollover()) this.changed();
  }

  /** Espera a que terminen las escrituras pendientes (para pruebas y para cerrar). */
  flush(): Promise<void> {
    return this.idle;
  }

  // -------------------------------------------------------------------------

  /** Vacía los rankings "del día" cuyo día ya pasó. Devuelve si vació alguno. */
  private rollover(): boolean {
    const today = dayKey(this.now());
    let cleared = false;
    for (const c of this.configs) {
      if (c.period !== "day") continue;
      const acc = this.acc(c.id);
      if (acc.day === today) continue;
      if (acc.day !== "" && acc.people.size > 0) {
        acc.people.clear();
        acc.updatedAt = this.now().getTime();
        cleared = true;
      }
      acc.day = today;
    }
    return cleared;
  }

  private emptyAcc(): Acc {
    return { people: new Map(), day: dayKey(this.now()), updatedAt: 0 };
  }

  private acc(id: string): Acc {
    let acc = this.accs.get(id);
    if (!acc) {
      acc = this.emptyAcc();
      this.accs.set(id, acc);
    }
    return acc;
  }

  private snapshot(config: TopConfig): TopState {
    const acc = this.acc(config.id);
    const entries = [...acc.people.values()]
      .sort(byScore)
      .slice(0, config.count)
      .map((p) => ({ name: p.name, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), score: p.score }));
    return { id: config.id, entries, updatedAt: acc.updatedAt };
  }

  private fromRuntime(rt: TopRuntime): Acc {
    const acc: Acc = { people: new Map(), day: rt.day, updatedAt: rt.updatedAt };
    for (const p of rt.people) acc.people.set(p.handle, toPerson(p));
    return acc;
  }

  private toRuntime(acc: Acc): TopRuntime {
    return { people: [...acc.people.values()].sort(byScore).slice(0, PERSIST_PEOPLE).map(toPerson), day: acc.day, updatedAt: acc.updatedAt };
  }

  private changed(): void {
    this.persist();
    this.emit("state");
  }

  private persist(): void {
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    this.idle = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          const runtime: Record<string, TopRuntime> = {};
          for (const c of this.configs) {
            const acc = this.accs.get(c.id);
            if (acc) runtime[c.id] = this.toRuntime(acc);
          }
          await this.store.save({ configs: this.configs, seededIds: this.seededIds, runtime });
        }
      } catch (err) {
        this.emit("log", { level: "error", message: `No se pudo guardar tops.json: ${(err as Error).message}` });
      } finally {
        this.saving = false;
      }
    })();
  }
}
