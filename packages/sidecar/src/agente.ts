import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentFileSchema,
  DEFAULT_JOIN_GIFT_NAMES,
  isJoinGift,
  buildTips,
  parseAgentCommand,
  type AgentConfig,
  type AgentCurrent,
  type AgentNotice,
  type AgentQueueItem,
  type AgentState,
  type LiveEvent,
} from "@streamtok/shared";
import { type AgentExpression, parseExpression } from "./agente-guard.js";
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
export type Responder = (question: string, ctx: { name: string; config: AgentConfig }) => Promise<string | AgentExpression>;

/** Tope de seguridad de una respuesta (el modelo recibe la orden de ser breve; esto solo evita un texto enorme). */
export const MAX_ANSWER_CHARS = 600;

/** Recorta sin partir una frase: corta en el último punto cercano al tope; si no hay, pone «…». */
export function clampAnswer(text: string, max = MAX_ANSWER_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), /[.!?]$/.test(head) ? head.length - 1 : -1);
  return end > max * 0.5 ? head.slice(0, end + 1) : `${head.slice(0, max - 1).trimEnd()}…`;
}

export const placeholderResponder: Responder = async (question) =>
  `Aún estoy en pruebas y no tengo cerebro conectado. Tu pregunta: ${question}`;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** Cuánto se queda a la vista un aviso a una persona. */
export const NOTICE_MS = 7_000;
/** Cuántos avisos a la vez (los más viejos se van). */
const MAX_NOTICES = 3;
/** Los seguidores nuevos se juntan este rato para darles un solo gracias... */
const FOLLOW_BATCH_MS = 6_000;
/** ...y entre un gracias de seguidores y el siguiente pasa al menos esto. */
const THANKS_GAP_MS = 15_000;
/** Entre dos avisos leídos en voz alta pasa al menos esto (el resto se ven pero no se leen). */
const SPEAK_GAP_MS = 8_000;
/** Cada persona recibe como mucho un gracias por regalo cada tanto. */
const GIFT_THANKS_GAP_MS = 60_000;
/** Regalo (monedas de una vez) que se agradece con más emoción. */
const BIG_GIFT_COINS = 150;

/** «A», «A y B», «A, B y C», «A, B, C y 2 más». */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} y ${names.length - 3} más`;
}

/** Nombre apto para decir en voz alta y mostrar: sin @, sin saltos y corto. */
function niceName(name: string): string {
  const t = name.replace(/^@/, "").replace(/\s+/g, " ").trim();
  return t.length > 20 ? `${t.slice(0, 19).trimEnd()}…` : t;
}

/** Cuánto se queda la respuesta en pantalla: lo que se tarda en leerla en voz alta, entre 6 y 45 s. */
export function showMsFor(answer: string): number {
  return Math.min(45_000, Math.max(6_000, 3_000 + answer.length * 70));
}

interface Waiting extends AgentQueueItem {
  handle: string;
  seq: number;
  /** veces que ya se intentó responder y falló el modelo (una pregunta se reintenta una vez antes de retirarse) */
  tries?: number;
}

interface Credit {
  coins: number;
  until: number;
}

export interface AgenteEngineOptions {
  store: AgenteStorePort;
  responder?: Responder;
  /** ¿puede salir un aviso periódico? (la trivia abierta lo bloquea) */
  canShowTip?: () => boolean;
  /** ¿está en pausa? (mientras hay una trivia en curso no se atienden preguntas: esperan en la cola) */
  paused?: () => boolean;
  /** reloj en ms (para pruebas) */
  now?: () => number;
  /** azar en [0,1) (para pruebas) */
  random?: () => number;
}

export class AgenteEngine extends EventEmitter {
  private config: AgentConfig;
  private queue: Waiting[] = [];
  private current: (AgentCurrent & { answerAt?: number }) | undefined;
  /** la pregunta que se está respondiendo, tal como esperaba en la fila (para devolverla si el modelo falla) */
  private currentSrc: Waiting | undefined;
  private nextFreeAt = 0;
  private tip: { id: string; text: string } | undefined;
  private tipUntil = 0;
  private nextTipAt = 0;
  private tipIndex = 0;
  private tipSeq = 0;
  private notices: (AgentNotice & { until: number })[] = [];
  private noticeSeq = 0;
  private pendingFollows: string[] = [];
  private followsSince = 0;
  private lastThanksAt = -Infinity;
  private lastSpokenAt = -Infinity;
  private lastGiftThanks = new Map<string, number>();
  private answered = 0;
  private lastError: { message: string; at: number } | undefined;
  private seq = 0;
  private followers = new Set<string>();
  private sharers = new Set<string>();
  private fanClub = new Set<string>();
  private credits = new Map<string, Credit>();
  private lastAsk = new Map<string, number>();
  private prizes = new Map<string, Credit>();
  private coinStreaks = new Map<string, number>();
  private saving = false;
  private dirty = false;
  private idle: Promise<void> = Promise.resolve();
  private store: AgenteStorePort;
  private responder: Responder;
  private now: () => number;
  private random: () => number;

  private opts: AgenteEngineOptions;

  constructor(opts: AgenteEngineOptions) {
    super();
    this.opts = opts;
    this.store = opts.store;
    this.responder = opts.responder ?? placeholderResponder;
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.config = this.store.load().config;
    this.nextTipAt = this.now() + this.config.tips.everySec * 1000;
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
      ...(this.tip ? { tip: this.tip } : {}),
      ...(this.notices.length > 0 ? { notices: this.notices.map(({ until: _until, ...n }) => n) } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      nextFreeAt: this.nextFreeAt,
      answered: this.answered,
      updatedAt: this.now(),
    };
  }

  save(config: AgentConfig): void {
    this.config = config;
    this.nextTipAt = Math.min(this.nextTipAt, this.now() + config.tips.everySec * 1000);
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
    this.prizes.clear();
    this.nextTipAt = this.now() + this.config.tips.everySec * 1000;
    this.lastAsk.clear();
    this.coinStreaks.clear();
    this.notices = [];
    this.pendingFollows = [];
    this.lastGiftThanks.clear();
    this.answered = 0;
    this.lastError = undefined;
    this.reset();
  }

  /** Premio de la trivia: la próxima pregunta de esta persona pasa primero (aunque no cumpla los requisitos) y se salta su espera. */
  grantPrize(handle: string, coins: number): void {
    const key = handleKey(handle);
    this.prizes.set(key, { coins, until: this.now() + this.config.giftCreditMin * 60_000 });
    this.lastAsk.delete(key);
  }

  /** ¿Hay una respuesta en pantalla o preguntas esperando? (la trivia no se mete en medio) */
  isBusy(): boolean {
    return this.current !== undefined || this.queue.length > 0;
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
    if (evt.event === "follow" && !this.followers.has(handle)) this.noteFollow(name);
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
        this.thankGift(handle, name, live === 0, live + delta, delta);
      }
      return;
    }

    if (evt.event !== "comment" || !this.config.enabled) return;
    const question = parseAgentCommand(this.config.command, evt.text);
    if (question === undefined) return;
    const text = clamp(question, this.config.maxQuestionChars);
    if (!text) return;
    const prize = this.activePrize(handle);
    const credit = this.activeCredit(handle) + prize;
    if (prize === 0 && !this.eligible(handle, credit)) return;
    const last = this.lastAsk.get(handle);
    if (last !== undefined && this.now() - last < this.config.userCooldownSec * 1000) return; // espera su turno para volver a preguntar
    if (this.enqueue(handle, name, evt.avatarUrl, text, credit)) {
      this.credits.delete(handle);
      this.prizes.delete(handle);
      this.lastAsk.set(handle, this.now());
    }
  }

  /** Avanza el agente: saca la respuesta de pantalla cuando se cumple su tiempo y atiende la siguiente pregunta. Se llama cada segundo. */
  tick(): void {
    const t = this.now();
    if (this.current?.answerAt !== undefined && t >= this.current.answerAt + this.current.showMs) {
      this.current = undefined;
      this.answered++;
      this.emit("state");
    }
    if (this.tip && (this.current || t >= this.tipUntil)) {
      this.tip = undefined;
      this.emit("state");
    }
    if (this.notices.some((n) => t >= n.until)) {
      this.notices = this.notices.filter((n) => t < n.until);
      this.emit("state");
    }
    this.flushFollows(t);
    if (this.current || !this.config.enabled) return;
    if (this.opts.paused?.()) return; // trivia en curso: la cola espera y se retoma al terminar
    if (!this.tip && this.config.tips.enabled && t >= this.nextTipAt && this.queue.length === 0 && (this.opts.canShowTip?.() ?? true)) {
      this.showTip();
      return;
    }
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
    this.currentSrc = next;
    this.tip = undefined; // la pregunta pasa por delante del aviso
    this.emit("state");
    void this.answer(cur);
  }

  /** Muestra el siguiente aviso periódico ya (botón de la app). Devuelve false si no hay avisos que mostrar. */
  showTip(): boolean {
    const tips = buildTips(this.config);
    if (tips.length === 0) return false;
    const t = this.now();
    const text = tips[this.tipIndex % tips.length];
    this.tipIndex++;
    this.tip = { id: `tip${++this.tipSeq}`, text };
    this.tipUntil = t + showMsFor(text);
    this.nextTipAt = t + this.config.tips.everySec * 1000;
    this.emit("state");
    return true;
  }

  /** Espera a que terminen las escrituras pendientes (para pruebas y para cerrar). */
  flush(): Promise<void> {
    return this.idle;
  }

  // -------------------------------------------------------------------------

  private async answer(cur: AgentCurrent & { answerAt?: number }): Promise<void> {
    let reply: string | AgentExpression;
    try {
      reply = await this.responder(cur.question, { name: cur.name, config: this.config });
    } catch (err) {
      const message = (err as Error).message;
      this.emit("log", { level: "error", message: `El agente no pudo responder: ${message}` });
      if (this.current !== cur) return;
      // Al público no se le enseña un error técnico: el motivo queda en el panel de la app. La pregunta vuelve a la fila una vez
      // (con su misma prioridad) y, si vuelve a fallar, se retira.
      const src = this.currentSrc;
      this.current = undefined;
      this.currentSrc = undefined;
      if (src && !src.tries && !this.queue.some((w) => w.handle === src.handle) && this.queue.length < this.config.maxQueue) {
        this.queue.unshift({ ...src, tries: 1 });
        if (src.coins === 0) this.nextFreeAt = Math.min(this.nextFreeAt, this.now() + 3000); // la gratis no espera otros 45 s
        this.emit("log", { level: "warn", message: `La pregunta de ${src.name} vuelve a la fila para reintentar.` });
      }
      this.lastError = { message, at: this.now() };
      this.emit("state");
      return;
    }
    if (this.current !== cur) return; // se reinició mientras pensaba
    this.lastError = undefined;
    // el modelo puede abrir su respuesta con [emoción, gesto]: se separa del texto y se guarda aparte
    const expr = typeof reply === "string" ? parseExpression(reply) : reply;
    cur.answer = clampAnswer(expr.text.trim()) || "…";
    if (expr.mood) cur.mood = expr.mood;
    if (expr.gesture) cur.gesture = expr.gesture;
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

  private activePrize(handle: string): number {
    const c = this.prizes.get(handle);
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
    this.noticeQueued(handle, name, coins);
    this.emit("state");
    return true;
  }

  // ---- avisos a cada persona ----------------------------------------------

  /** Pone un aviso a la vista unos segundos. `speak` pide leerlo en voz alta (si está permitido y no hay otro leído hace poco). */
  private pushNotice(kind: AgentNotice["kind"], text: string, speak: boolean, mood: AgentNotice["mood"] = "happy"): void {
    if (!this.config.tips.personal) return;
    const t = this.now();
    const spoken = speak && this.config.tips.speakThanks && t - this.lastSpokenAt >= SPEAK_GAP_MS;
    if (spoken) this.lastSpokenAt = t;
    this.notices.push({ id: `n${++this.noticeSeq}`, text, kind, speak: spoken, mood, until: t + NOTICE_MS });
    while (this.notices.length > MAX_NOTICES) this.notices.shift();
  }

  /** ¿Esta pregunta se atenderá ya, sin esperar? (entonces no hace falta decir que está en la fila) */
  private startsNow(coins: number): boolean {
    if (this.current || !this.config.enabled || this.opts.paused?.()) return false;
    return coins > 0 || (this.queue.length === 1 && this.now() >= this.nextFreeAt);
  }

  private noticeQueued(handle: string, name: string, coins: number): void {
    if (this.startsNow(coins)) return;
    const who = niceName(name);
    const pos = this.ordered().findIndex((w) => w.handle === handle) + 1;
    if (coins > 0) this.pushNotice("queue", `¡Gracias ${who}! Tu pregunta tiene prioridad · lugar #${pos}`, false);
    else this.pushNotice("queue", `${who}, tu pregunta está en la fila (${this.queue.length} esperando)`, false);
  }

  /** Un regalo: si ya tenía una pregunta esperando, sube a prioridad; si no, se le avisa que ya puede preguntar con prioridad. */
  private thankGift(handle: string, name: string, firstCredit: boolean, total: number, delta: number): void {
    const t = this.now();
    const who = niceName(name);
    const mood = delta >= BIG_GIFT_COINS ? "excited" : "happy";
    const waiting = this.queue.find((w) => w.handle === handle);
    if (waiting && total > waiting.coins) {
      waiting.coins = total;
      this.credits.delete(handle);
      this.lastGiftThanks.set(handle, t);
      const pos = this.ordered().findIndex((w) => w.handle === handle) + 1;
      this.pushNotice("gift", `¡Gracias ${who}! Tu pregunta subió a Prioridad · lugar #${pos}`, true, mood);
      this.emit("state");
      return;
    }
    if (!firstCredit || !this.config.eligibility.gift || !this.config.enabled) return;
    if (t - (this.lastGiftThanks.get(handle) ?? -Infinity) < GIFT_THANKS_GAP_MS) return;
    this.lastGiftThanks.set(handle, t);
    this.pushNotice("gift", `¡Gracias ${who}! Eres Prioridad: escribe ${this.config.command} y tu pregunta (tienes ${this.config.giftCreditMin} min)`, true, mood);
    this.emit("state");
  }

  private noteFollow(name: string): void {
    if (!this.config.enabled || !this.config.tips.thanksFollows) return;
    const who = niceName(name);
    if (!who || this.pendingFollows.includes(who) || this.pendingFollows.length >= 20) return;
    if (this.pendingFollows.length === 0) this.followsSince = this.now();
    this.pendingFollows.push(who);
  }

  /** Cuando pasó el rato de juntar seguidores (y no se acaba de agradecer a otros), un solo gracias con sus nombres. */
  private flushFollows(t: number): void {
    if (this.pendingFollows.length === 0) return;
    if (t - this.followsSince < FOLLOW_BATCH_MS || t - this.lastThanksAt < THANKS_GAP_MS) return;
    const names = joinNames(this.pendingFollows);
    this.pendingFollows = [];
    this.lastThanksAt = t;
    const how = this.config.eligibility.follow ? ` Ya puedes preguntar gratis: escribe ${this.config.command} y tu pregunta.` : "";
    this.pushNotice("thanks", `¡Gracias por seguir el canal, ${names}!${how}`, true);
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
  return { id: c.id, name: c.name, ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}), question: c.question, coins: c.coins, answer: c.answer, startedAt: c.startedAt, showMs: c.showMs, ...(c.mood ? { mood: c.mood } : {}), ...(c.gesture ? { gesture: c.gesture } : {}) };
}
