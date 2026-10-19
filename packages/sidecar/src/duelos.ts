import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  commandMatches,
  DuelosFileSchema,
  giftMatches,
  type DuelConfig,
  type DuelRuntime,
  type DuelSideState,
  type DuelState,
  type LiveEvent,
  type PersistedPerson,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor de duelos (ADR 0015). Suma los eventos que ya existen (regalos, likes, comentarios) en
 * dos lados y guarda el marcador, para los overlays `/overlay/duelo/<id>`.
 *
 * Eventos: `state` (cambió algo: configuración o marcador), `log` ({level, message}).
 */

export type PersistedDuelos = ReturnType<typeof DuelosFileSchema.parse>;

export interface DuelosStorePort {
  load(): PersistedDuelos;
  save(data: PersistedDuelos): Promise<void>;
}

export function defaultDuelosFilePath(): string {
  return join(appDataDir(), "duelos.json");
}

export class DuelosStore implements DuelosStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedDuelos {
    const defaults = DuelosFileSchema.parse({});
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
    const parsed = DuelosFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("duelos.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: PersistedDuelos): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, this.filePath);
  }
}

type Person = PersistedPerson;
type Side = 0 | 1;

/** Marcador en memoria de un duelo. */
interface Acc {
  scores: [number, number];
  supporters: [Map<string, Person>, Map<string, Person>];
  members: Map<string, Side>;
  donors: Map<string, Person>;
  updatedAt: number;
}

const MAX_SUPPORTERS = 100; // por lado
const MAX_DONORS = 300;
const MAX_MEMBERS = 5000;
const PERSIST_SUPPORTERS = 20;
const PERSIST_DONORS = 100;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const byScore = (a: Person, b: Person) => b.score - a.score;

function emptyAcc(): Acc {
  return { scores: [0, 0], supporters: [new Map(), new Map()], members: new Map(), donors: new Map(), updatedAt: 0 };
}

/** Deja los `keep` mejores cuando el mapa crece demasiado. */
function trim(map: Map<string, Person>, max: number): void {
  if (map.size <= max * 2) return;
  const best = [...map.values()].sort(byScore).slice(0, max);
  map.clear();
  for (const p of best) map.set(p.handle, p);
}

function add(map: Map<string, Person>, handle: string, name: string, avatarUrl: string | undefined, delta: number, max: number): void {
  const cur = map.get(handle);
  if (cur) {
    cur.score += delta;
    cur.name = name;
    if (avatarUrl) cur.avatarUrl = avatarUrl;
  } else {
    map.set(handle, { handle, name, ...(avatarUrl ? { avatarUrl } : {}), score: delta });
    trim(map, max);
  }
}

function toPerson(p: Person): Person {
  return { handle: p.handle, name: p.name, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), score: p.score };
}

export interface DuelosEngineOptions {
  store: DuelosStorePort;
  /** duelos que se crean la primera vez (uno que borres no reaparece) */
  presets?: DuelConfig[];
}

export class DuelosEngine extends EventEmitter {
  private configs: DuelConfig[];
  private seededIds: string[];
  private accs = new Map<string, Acc>();
  /** acumulados del combo en curso, para sumar solo lo nuevo de cada mensaje */
  private coinStreaks = new Map<string, number>();
  private unitStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private idle: Promise<void> = Promise.resolve();
  private store: DuelosStorePort;

  constructor(opts: DuelosEngineOptions) {
    super();
    this.store = opts.store;
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

  getConfigs(): DuelConfig[] {
    return this.configs;
  }

  getStates(): DuelState[] {
    return this.configs.map((c) => this.snapshot(c));
  }

  getState(id: string): DuelState | undefined {
    const config = this.configs.find((c) => c.id === id);
    return config ? this.snapshot(config) : undefined;
  }

  save(config: DuelConfig): void {
    const i = this.configs.findIndex((c) => c.id === config.id);
    if (i === -1) this.configs.push(config);
    else this.configs[i] = config;
    this.changed();
  }

  /** Marcador a cero (y equipos vacíos). */
  reset(id: string): void {
    if (!this.configs.some((c) => c.id === id)) return;
    this.accs.set(id, emptyAcc());
    this.accs.get(id)!.updatedAt = Date.now();
    this.changed();
  }

  /** Suma o resta puntos a un lado a mano (corregir un error). No baja de cero. */
  adjust(id: string, side: Side, delta: number): void {
    const config = this.configs.find((c) => c.id === id);
    if (!config || config.mode === "top" || !isNum(delta)) return;
    const acc = this.acc(id);
    acc.scores[side] = Math.max(0, acc.scores[side] + delta);
    acc.updatedAt = Date.now();
    this.changed();
  }

  /**
   * Regalos de prueba (botón "Iniciar test"): una persona de prueba manda `units` regalos, solo en este duelo.
   * - regalos: suma al lado indicado; con monedas vale `units` veces el valor del regalo del lado (`cost`).
   * - equipos: la persona entra al equipo indicado (si aún no tenía) y suma a su equipo.
   * - top: suma a esa persona en el ranking de donadores (`coins` por regalo).
   */
  test(id: string, side: Side, units: number, name: string, coins?: number): void {
    const config = this.configs.find((c) => c.id === id);
    if (!config || !isNum(units) || units < 1) return;
    const acc = this.acc(id);
    const handle = `@prueba-${name.toLowerCase()}`;
    const each = isNum(coins) && coins > 0 ? coins : 1;

    if (config.mode === "top") {
      add(acc.donors, handle, name, undefined, units * each, MAX_DONORS);
    } else if (config.mode === "equipos") {
      if (!acc.members.has(handle)) {
        if (acc.members.size >= MAX_MEMBERS) return;
        acc.members.set(handle, side);
      }
      const team = acc.members.get(handle) as Side;
      const value = config.metric === "coins" ? units * each : units;
      acc.scores[team] += value;
      add(acc.supporters[team], handle, name, undefined, value, MAX_SUPPORTERS);
    } else {
      const cost = config.sides[side].cost;
      const value = config.metric === "coins" ? units * (cost && cost > 0 ? cost : 1) : units;
      acc.scores[side] += value;
      add(acc.supporters[side], handle, name, undefined, value, MAX_SUPPORTERS);
    }
    acc.updatedAt = Date.now();
    this.changed();
  }

  handleLiveEvent(evt: LiveEvent): void {
    if (this.configs.length === 0) return;
    const handle = handleKey(evt.username);
    const name = evt.nickname?.trim() || evt.username.replace(/^@/, "");
    let coins = 0;
    let units = 0;
    if (evt.event === "gift") {
      // `coins` y `repeatCount` son acumulados del combo: se cuenta solo lo nuevo.
      const key = `${handle}|${evt.giftId ?? evt.giftName ?? "?"}`;
      const totalCoins = isNum(evt.coins) ? evt.coins : 0;
      const totalUnits = isNum(evt.repeatCount) ? evt.repeatCount : 1;
      coins = Math.max(0, totalCoins - (this.coinStreaks.get(key) ?? 0));
      units = Math.max(0, totalUnits - (this.unitStreaks.get(key) ?? 0));
      if (evt.repeatEnd === false) {
        this.coinStreaks.set(key, totalCoins);
        this.unitStreaks.set(key, totalUnits);
      } else {
        this.coinStreaks.delete(key);
        this.unitStreaks.delete(key);
      }
    }
    let touched = false;
    for (const config of this.configs) {
      if (this.apply(config, evt, handle, name, coins, units)) touched = true;
    }
    if (touched) this.changed();
  }

  /**
   * Nuevo LIVE: el ranking de donadores es "de la sesión", así que el Top 1 vs Top 2 empieza de cero.
   * Los demás duelos conservan su marcador (se reinician a mano) para no perderlo si se cae la conexión.
   */
  resetSession(): void {
    this.coinStreaks.clear();
    this.unitStreaks.clear();
    let touched = false;
    for (const c of this.configs) {
      if (c.mode !== "top") continue;
      const acc = this.acc(c.id);
      if (acc.donors.size === 0) continue;
      acc.donors.clear();
      acc.updatedAt = Date.now();
      touched = true;
    }
    if (touched) this.changed();
  }

  /** Espera a que terminen las escrituras pendientes (para pruebas y para cerrar). */
  flush(): Promise<void> {
    return this.idle;
  }

  // -------------------------------------------------------------------------

  private apply(config: DuelConfig, evt: LiveEvent, handle: string, name: string, coins: number, units: number): boolean {
    const acc = this.acc(config.id);
    const { avatarUrl } = evt;
    const touch = () => {
      acc.updatedAt = Date.now();
      return true;
    };

    if (config.mode === "regalos") {
      if (evt.event !== "gift") return false;
      for (const side of [0, 1] as const) {
        if (!giftMatches(config.sides[side].gifts, evt.giftName, evt.giftId)) continue;
        const value = config.metric === "coins" ? coins : units;
        if (value <= 0) return false;
        acc.scores[side] += value;
        add(acc.supporters[side], handle, name, avatarUrl, value, MAX_SUPPORTERS);
        return touch();
      }
      return false;
    }

    if (config.mode === "top") {
      if (evt.event !== "gift" || coins <= 0) return false;
      add(acc.donors, handle, name, avatarUrl, coins, MAX_DONORS);
      return touch();
    }

    // equipos
    if (evt.event === "comment") {
      for (const side of [0, 1] as const) {
        if (!commandMatches(config.sides[side].commands, evt.text)) continue;
        if (acc.members.has(handle) || acc.members.size >= MAX_MEMBERS) return false;
        acc.members.set(handle, side);
        return touch(); // el comando de unirse no cuenta como comentario
      }
    }
    const side = acc.members.get(handle);
    if (side === undefined) return false;
    let value = 0;
    if (evt.event === "gift") value = config.metric === "coins" ? coins : config.metric === "gifts" ? units : 0;
    else if (evt.event === "like") value = config.metric === "likes" ? (isNum(evt.likeCount) ? evt.likeCount : 1) : 0;
    else if (evt.event === "comment") value = config.metric === "comments" ? 1 : 0;
    if (value <= 0) return false;
    acc.scores[side] += value;
    add(acc.supporters[side], handle, name, avatarUrl, value, MAX_SUPPORTERS);
    return touch();
  }

  private acc(id: string): Acc {
    let acc = this.accs.get(id);
    if (!acc) {
      acc = emptyAcc();
      this.accs.set(id, acc);
    }
    return acc;
  }

  private snapshot(config: DuelConfig): DuelState {
    const acc = this.acc(config.id);
    if (config.mode === "top") {
      const best = [...acc.donors.values()].sort(byScore);
      const side = (p?: Person): DuelSideState =>
        p ? { score: p.score, supporters: [], name: p.name, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) } : { score: 0, supporters: [] };
      return { id: config.id, sides: [side(best[0]), side(best[1])], updatedAt: acc.updatedAt };
    }
    const counts: [number, number] = [0, 0];
    if (config.mode === "equipos") for (const s of acc.members.values()) counts[s]++;
    const side = (i: Side): DuelSideState => ({
      score: acc.scores[i],
      supporters: [...acc.supporters[i].values()]
        .sort(byScore)
        .slice(0, 3)
        .map((p) => ({ name: p.name, ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}), score: p.score })),
      ...(config.mode === "equipos" ? { members: counts[i] } : {}),
    });
    return { id: config.id, sides: [side(0), side(1)], updatedAt: acc.updatedAt };
  }

  private fromRuntime(rt: DuelRuntime): Acc {
    const acc = emptyAcc();
    for (const i of [0, 1] as const) {
      acc.scores[i] = rt.sides[i].score;
      for (const p of rt.sides[i].supporters) acc.supporters[i].set(p.handle, toPerson(p));
    }
    for (const [h, s] of Object.entries(rt.members)) acc.members.set(h, s);
    for (const p of rt.donors) acc.donors.set(p.handle, toPerson(p));
    acc.updatedAt = rt.updatedAt;
    return acc;
  }

  private toRuntime(acc: Acc): DuelRuntime {
    const top = (m: Map<string, Person>, n: number) => [...m.values()].sort(byScore).slice(0, n).map(toPerson);
    return {
      sides: [
        { score: acc.scores[0], supporters: top(acc.supporters[0], PERSIST_SUPPORTERS) },
        { score: acc.scores[1], supporters: top(acc.supporters[1], PERSIST_SUPPORTERS) },
      ],
      members: Object.fromEntries(acc.members) as Record<string, Side>,
      donors: top(acc.donors, PERSIST_DONORS),
      updatedAt: acc.updatedAt,
    };
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
          const runtime: Record<string, DuelRuntime> = {};
          for (const c of this.configs) {
            const acc = this.accs.get(c.id);
            if (acc) runtime[c.id] = this.toRuntime(acc);
          }
          await this.store.save({ configs: this.configs, seededIds: this.seededIds, runtime });
        }
      } catch (err) {
        this.emit("log", { level: "error", message: `No se pudo guardar duelos.json: ${(err as Error).message}` });
      } finally {
        this.saving = false;
      }
    })();
  }
}
