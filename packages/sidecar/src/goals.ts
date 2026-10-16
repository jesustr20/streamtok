import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GoalsFileSchema, type Goal, type GoalConfig, type GoalOp, type LiveEvent } from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor de Metas (ADR 0012): cada meta cuenta una métrica del LIVE hacia un
 * objetivo. Varias a la vez, cada una con su id. Es la única fuente de verdad;
 * la UI y los overlays lo leen por el canal WS `goals`.
 *
 * Eventos: `state` (cada cambio), `goal-reached` (Goal, una vez por cruce),
 * `log` ({level, message, details?}).
 */

export type PersistedGoals = ReturnType<typeof GoalsFileSchema.parse>;

export interface GoalsStorePort {
  load(): PersistedGoals;
  save(data: PersistedGoals): Promise<void>;
}

export function defaultGoalsFilePath(): string {
  return join(appDataDir(), "goals.json");
}

export class GoalsStore implements GoalsStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedGoals {
    const defaults = GoalsFileSchema.parse({});
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
    const parsed = GoalsFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("goals.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: PersistedGoals): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface GoalsEngineOptions {
  store: GoalsStorePort;
  /** metas que se crean la primera vez (si el archivo aún no las sembró) */
  presets?: GoalConfig[];
}

export class GoalsEngine extends EventEmitter {
  private goals: Goal[];
  private seeded: boolean;
  /** Combos en curso: usuario|regalo → monedas / unidades ya contadas. */
  private coinStreaks = new Map<string, number>();
  private unitStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private store: GoalsStorePort;

  constructor(opts: GoalsEngineOptions) {
    super();
    this.store = opts.store;
    const loaded = this.store.load();
    this.goals = loaded.goals;
    this.seeded = loaded.seeded;
    if (!this.seeded && opts.presets) {
      for (const config of opts.presets) {
        if (!this.find(config.id)) {
          this.goals.push({ config, state: { id: config.id, current: 0, target: config.target, reached: 0 } });
        }
      }
      this.seeded = true;
      this.persist();
    }
  }

  getGoals(): Goal[] {
    return this.goals.map((g) => ({ config: g.config, state: { ...g.state } }));
  }

  private find(id: string): Goal | undefined {
    return this.goals.find((g) => g.config.id === id);
  }

  private changed() {
    this.emit("state");
    this.persist();
  }

  private persist() {
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    const run = async () => {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.store.save({ goals: this.getGoals(), seeded: this.seeded });
        } catch (err) {
          this.emit("log", { level: "warn", message: `No se pudo guardar las metas: ${(err as Error).message}` });
        }
      }
      this.saving = false;
    };
    void run();
  }

  /** Crea la meta o actualiza su configuración, conservando el avance. */
  save(config: GoalConfig) {
    const existing = this.find(config.id);
    if (existing) {
      const targetChanged = existing.config.target !== config.target;
      existing.config = config;
      if (targetChanged) existing.state.target = config.target;
    } else {
      this.goals.push({ config, state: { id: config.id, current: 0, target: config.target, reached: 0 } });
    }
    this.changed();
  }

  remove(id: string) {
    const before = this.goals.length;
    this.goals = this.goals.filter((g) => g.config.id !== id);
    if (this.goals.length !== before) this.changed();
  }

  /** Control manual. Devuelve false si la meta no existe. */
  control(id: string, op: GoalOp, value?: number): boolean {
    const g = this.find(id);
    if (!g) return false;
    if (op === "reset") {
      g.state = { id, current: 0, target: g.config.target, reached: 0 };
    } else if (op === "add") {
      this.advance(g, Math.round(value ?? 0));
    } else {
      g.state.current = Math.round(value ?? 0);
    }
    this.changed();
    return true;
  }

  /** Suma `delta` y aplica lo que corresponda al cumplirse la meta. */
  private advance(g: Goal, delta: number) {
    const s = g.state;
    const wasReached = s.current >= s.target;
    s.current += delta;
    const { onReach, step } = g.config;
    if (onReach === "stay") {
      if (s.current >= s.target && !wasReached) {
        s.reached++;
        this.emit("goal-reached", this.snapshot(g));
      }
      return;
    }
    while (s.current >= s.target) {
      s.reached++;
      this.emit("goal-reached", this.snapshot(g));
      if (onReach === "grow") s.target += step;
      else s.current -= s.target;
    }
  }

  private snapshot(g: Goal): Goal {
    return { config: g.config, state: { ...g.state } };
  }

  handleLiveEvent(evt: LiveEvent) {
    if (this.goals.length === 0) return;
    let coins = 0;
    let units = 0;
    if (evt.event === "gift") {
      // `coins` y `repeatCount` son acumulados del combo: se cuenta solo lo nuevo.
      const key = `${handleKey(evt.username)}|${evt.giftId ?? evt.giftName ?? "?"}`;
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
    for (const g of this.goals) {
      const { metric, giftId } = g.config;
      let delta = 0;
      switch (evt.event) {
        case "gift":
          if (giftId !== undefined && evt.giftId !== giftId) break;
          if (metric === "coins") delta = coins;
          else if (metric === "gifts") delta = units;
          break;
        case "like":
          if (metric === "likes") delta = evt.likeCount ?? 1;
          break;
        case "follow":
          if (metric === "follows") delta = 1;
          break;
        case "share":
          if (metric === "shares") delta = 1;
          break;
        case "subscribe":
          if (metric === "subscribes") delta = 1;
          break;
        case "comment":
          if (metric === "comments") delta = 1;
          break;
        default:
          break;
      }
      if (delta !== 0) {
        this.advance(g, delta);
        touched = true;
      }
    }
    if (touched) this.changed();
  }

  /** Nueva sesión de LIVE: se olvidan los combos en curso; el avance se conserva. */
  resetSession() {
    this.coinStreaks.clear();
    this.unitStreaks.clear();
  }
}
