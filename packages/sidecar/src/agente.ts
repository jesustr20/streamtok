import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentFileSchema,
  DEFAULT_JOIN_GIFT_NAMES,
  isJoinGift,
  parseAgentCommand,
  type AgentConfig,
  type AgentCurrent,
  type AgentQueueItem,
  type AgentState,
  type LiveEvent,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor del agente IA (ADR 0016), pieza 1: la cola de preguntas con prioridad. Todavía SIN modelo:
 * las respuestas las da un `Responder` que se puede cambiar (el de fábrica es un texto de prueba).
 *
 * Reglas:
 *  - pregunta quien escribe `!ia <pregunta>` (el comando es configurable) y cumple lo que el streamer
 *    marcó: sigue el canal, compartió el LIVE, es del Fan Club o mandó un regalo;
 *  - las preguntas respaldadas por regalo pasan primero (más monedas, antes; empate: la primera);
 *  - las gratis salen una cada `freeEverySec` segundos, escogida al azar entre las que esperan;
 *  - una persona tiene a lo sumo una pregunta esperando.
 *
 * Eventos: `state` (cambió algo), `log` ({level, message}).
 */

export type PersistedAgente = ReturnType<typeof AgentFileSchema.parse>;

export interface AgenteStorePort {
  load(): PersistedAgente;
  save(data: PersistedAgente): Promise<void>;
}

export function defaultAgenteFilePath(): string {
  return join(appDataDir(), "agente.json");
}

export class AgenteStore implements AgenteStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedAgente {
    const defaults = AgentFileSchema.parse({});
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
    const parsed = AgentFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("agente.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: PersistedAgente): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, this.filePath);
  }
}

/** Quien da las respuestas. La pieza 2 pone aquí el modelo (DeepSeek, OpenAI, Claude...). */
export type Responder = (question: string, ctx: { name: string; config: AgentConfig }) => Promise<string>;

/** Lo que cabe en un comentario de TikTok. */
export const MAX_ANSWER_CHARS = 150;

export const placeholderResponder: Responder = async (question) =>
  `Aún estoy en pruebas y no tengo cerebro conectado. Tu pregunta: ${question}`;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Cuánto se queda la respuesta en pantalla: lo que se tarda en leer, entre 6 y 20 s. */
export function showMsFor(answer: string): number {
  return Math.min(20_000, Math.max(6_000, 3_000 + answer.length * 70));
}

interface Waiting extends AgentQueueItem {
  handle: string;
  seq: number;
}

interface Credit {
  coins: number;
  until: number;
}

export interface AgenteEngineOptions {
  store: AgenteStorePort;
  responder?: Responder;
  /** reloj en ms (para pruebas) */
  now?: () => number;
  /** azar en [0,1) (para pruebas) */
  random?: () => number;
}

export class AgenteEngine extends EventEmitter {
  private config: AgentConfig;
  private queue: Waiting[] = [];
  private current: (AgentCurrent & { answerAt?: number }) | undefined;
  private nextFreeAt = 0;
  private answered = 0;
  private seq = 0;
  private followers = new Set<string>();
  private sharers = new Set<string>();
  private fanClub = new Set<string>();
  private credits = new Map<string, Credit>();
  private coinStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private idle: Promise<void> = Promise.resolve();
  private store: AgenteStorePort;
  private responder: Responder;
  private now: () => number;
  private random: () => number;

  constructor(opts: AgenteEngineOptions) {
    super();
    this.store = opts.store;
    this.responder = opts.responder ?? placeholderResponder;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.config = this.store.load().config;
  }

  getConfig(): AgentConfig {
    return this.config;
  }

  setResponder(responder: Responder): void {
    this.responder = responder;
  }

  getState(): AgentState {
    const ordered = this.ordered();
    return {
      queueSize: this.queue.length,
      queue: ordered.slice(0, 5).map(toItem),
      ...(this.current ? { current: toCurrent(this.current) } : {}),
      nextFreeAt: this.nextFreeAt,
      answered: this.answered,
      updatedAt: this.now(),
    };
  }

  save(config: AgentConfig): void {
    this.config = config;
    this.persist();
    this.emit("state");
  }

  /** Vacía la cola y la respuesta en pantalla. */
  reset(): void {
    this.queue = [];
    this.current = undefined;
    this.nextFreeAt = 0;
    this.emit("state");
  }

  /** Nuevo LIVE: se olvida quién siguió, compartió o regaló, y la cola. */
  resetSession(): void {
    this.followers.clear();
    this.sharers.clear();
    this.fanClub.clear();
    this.credits.clear();
    this.coinStreaks.clear();
    this.answered = 0;
    this.reset();
  }

  /** Pregunta de prueba desde la app: no pasa por el chat ni pide requisitos. */
  ask(name: string, question: string, coins = 0): boolean {
    const text = clamp(question.trim(), this.config.maxQuestionChars);
    if (!text) return false;
    return this.enqueue(`@prueba-${name.toLowerCase()}`, name, undefined, text, Math.max(0, Math.trunc(coins)));
  }

  handleLiveEvent(evt: LiveEvent): void {
    const handle = handleKey(evt.username);
    if (!handle) return;
    const name = evt.nickname?.trim() || evt.username.replace(/^@/, "");
    if (evt.isFollower === true || evt.event === "follow") this.followers.add(handle);
    if (evt.event === "share") this.sharers.add(handle);
    if (isNum(evt.fanLevel) && evt.fanLevel > 0) this.fanClub.add(handle);

    if (evt.event === "gift") {
      // `coins` es el acumulado del combo: se acredita solo lo nuevo.
      const key = `${handle}|${evt.giftId ?? evt.giftName ?? "?"}`;
      const total = isNum(evt.coins) ? evt.coins : 0;
      const delta = Math.max(0, total - (this.coinStreaks.get(key) ?? 0));
      if (evt.repeatEnd === false) this.coinStreaks.set(key, total);
      else this.coinStreaks.delete(key);
      if (isJoinGift(evt.giftName, DEFAULT_JOIN_GIFT_NAMES)) this.fanClub.add(handle);
      if (delta > 0) {
        const cur = this.credits.get(handle);
        const live = cur && cur.until > this.now() ? cur.coins : 0;
        this.credits.set(handle, { coins: live + delta, until: this.now() + this.config.giftCreditMin * 60_000 });
      }
      return;
    }

    if (evt.event !== "comment" || !this.config.enabled) return;
    const question = parseAgentCommand(this.config.command, evt.text);
    if (question === undefined) return;
    const text = clamp(question, this.config.maxQuestionChars);
    if (!text) return;
    const credit = this.activeCredit(handle);
    if (!this.eligible(handle, credit)) return;
    if (this.enqueue(handle, name, evt.avatarUrl, text, credit)) this.credits.delete(handle);
  }

  /** Avanza el agente: saca la respuesta de pantalla cuando se cumple su tiempo y atiende la siguiente pregunta. Se llama cada segundo. */
  tick(): void {
    const t = this.now();
    if (this.current?.answerAt !== undefined && t >= this.current.answerAt + this.current.showMs) {
      this.current = undefined;
      this.answered++;
      this.emit("state");
    }
    if (this.current || !this.config.enabled) return;
    const next = this.pickNext(t);
    if (!next) return;
    this.queue = this.queue.filter((w) => w !== next);
    if (next.coins === 0) this.nextFreeAt = t + this.config.freeEverySec * 1000;
    const cur: AgentCurrent & { answerAt?: number } = {
      id: next.id,
      name: next.name,
      ...(next.avatarUrl ? { avatarUrl: next.avatarUrl } : {}),
      question: next.question,
      coins: next.coins,
      answer: "",
      startedAt: t,
      showMs: 0,
    };
    this.current = cur;
    this.emit("state");
    void this.answer(cur);
  }

  /** Espera a que terminen las escrituras pendientes (para pruebas y para cerrar). */
  flush(): Promise<void> {
    return this.idle;
  }

  // -------------------------------------------------------------------------

  private async answer(cur: AgentCurrent & { answerAt?: number }): Promise<void> {
    let text: string;
    try {
      text = await this.responder(cur.question, { name: cur.name, config: this.config });
    } catch (err) {
      this.emit("log", { level: "error", message: `El agente no pudo responder: ${(err as Error).message}` });
      text = "No pude responder ahora, intenta de nuevo en un rato.";
    }
    if (this.current !== cur) return; // se reinició mientras pensaba
    cur.answer = clamp(text.trim(), MAX_ANSWER_CHARS) || "…";
    cur.showMs = showMsFor(cur.answer);
    cur.answerAt = this.now();
    this.emit("state");
  }

  private pickNext(t: number): Waiting | undefined {
    const paid = this.ordered().find((w) => w.coins > 0);
    if (paid) return paid;
    if (t < this.nextFreeAt || this.queue.length === 0) return undefined;
    return this.queue[Math.min(this.queue.length - 1, Math.floor(this.random() * this.queue.length))];
  }

  /** Orden en que se atenderán: primero las de regalo (más monedas antes), luego las gratis por llegada. */
  private ordered(): Waiting[] {
    return [...this.queue].sort((a, b) => b.coins - a.coins || a.seq - b.seq);
  }

  private activeCredit(handle: string): number {
    const c = this.credits.get(handle);
    return c && c.until > this.now() ? c.coins : 0;
  }

  private eligible(handle: string, credit: number): boolean {
    const e = this.config.eligibility;
    return (
      (e.follow && this.followers.has(handle)) ||
      (e.share && this.sharers.has(handle)) ||
      (e.fanClub && this.fanClub.has(handle)) ||
      (e.gift && credit > 0)
    );
  }

  private enqueue(handle: string, name: string, avatarUrl: string | undefined, question: string, coins: number): boolean {
    if (this.queue.some((w) => w.handle === handle)) return false;
    if (this.queue.length >= this.config.maxQueue) return false;
    this.seq++;
    this.queue.push({
      id: `q${this.seq}`,
      handle,
      seq: this.seq,
      name,
      ...(avatarUrl ? { avatarUrl } : {}),
      question,
      coins,
      at: this.now(),
    });
    this.emit("state");
    return true;
  }

  private persist(): void {
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    this.idle = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await this.store.save({ config: this.config });
        }
      } catch (err) {
        this.emit("log", { level: "error", message: `No se pudo guardar agente.json: ${(err as Error).message}` });
      } finally {
        this.saving = false;
      }
    })();
  }
}

function toItem(w: Waiting): AgentQueueItem {
  return { id: w.id, name: w.name, ...(w.avatarUrl ? { avatarUrl: w.avatarUrl } : {}), question: w.question, coins: w.coins, at: w.at };
}

function toCurrent(c: AgentCurrent): AgentCurrent {
  return { id: c.id, name: c.name, ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}), question: c.question, coins: c.coins, answer: c.answer, startedAt: c.startedAt, showMs: c.showMs };
}
