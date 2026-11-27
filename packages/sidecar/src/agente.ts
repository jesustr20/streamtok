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
export type Responder = (question: string, ctx: { name: string; handle?: string; config: AgentConfig; chat?: boolean; host?: boolean }) => Promise<string | AgentExpression>;

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
/** conversación natural: tras responderle a alguien, lo que escriba en este tiempo se toma como respuesta suya */
const FOLLOWUP_MS = 60_000;
/** conversación natural: máximo de elementos en la fila para que entre charla */
const CHAT_MAX_QUEUE = 2;
/** conversación natural: la charla que espera más que esto se descarta */
const CHAT_STALE_MS = 60_000;
/** el dueño del LIVE (ADR 0026): cuánto tras una respuesta suya lo que diga sigue siendo para el agente sin repetir su nombre */
export const HOST_FOLLOWUP_MS = 20_000;
/** tras callarla por voz, el agente espera esto antes de seguir con el chat */
const SOFT_STOP_PAUSE_MS = 3_000;
/** el dueño del LIVE: cuántas peticiones suyas pueden esperar a la vez */
const HOST_MAX_QUEUE = 3;
/** cuántas respuestas recientes recuerda el agente para explicarlas */
const HISTORY_MAX = 6;
/** «un momento» del agente cuando el dueño le habla y está ocupado respondiendo al chat */
const HOST_WAIT_LINES = [
  "Un momento, {n}, termino con esto y te atiendo.",
  "Dame un segundo, {n}: acabo esta respuesta y voy contigo.",
  "{n}, ya casi: termino con el chat y te contesto.",
  "Te oigo, {n}. Un momento y estoy contigo.",
];

const plain = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** ¿El mensaje nombra al agente? Palabra completa, sin tildes ni mayúsculas; vale su nombre entero o la primera palabra si es larga. */
export function mentions(text: string, agentName: string): boolean {
  const name = plain(agentName).replace(/[^a-z0-9ñ ]/g, " ").trim();
  if (!name) return false;
  const first = name.split(/\s+/)[0] ?? "";
  const candidates = [name, ...(first.length >= 4 && first !== name ? [first] : [])];
  const t = ` ${plain(text).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ")} `;
  return candidates.some((c) => t.includes(` ${c} `));
}
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
  /** charla del chat sin comando (ADR 0024, §5): va después de las preguntas y de los regalos */
  casual?: boolean;
  /** el dueño del LIVE (ADR 0026): pasa antes que todo y no pide requisitos */
  host?: boolean;
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
  /** una persona entró a la fila con una pregunta (la memoria del agente anota al viewer; ADR 0024) */
  onQuestion?: (handle: string, name: string, question: string) => void;
  /** ¿este viewer está ignorado en este LIVE? (tres intentos de manipular al agente; ADR 0024, §7): su pregunta no entra a la fila */
  isIgnored?: (handle: string) => boolean;
  /** ¿este usuario es el dueño del LIVE? (ADR 0026): sus mensajes con el nombre del agente o el comando son órdenes, con prioridad */
  isHost?: (handle: string) => boolean;
  /** el @ del dueño del LIVE, para anotar sus peticiones por voz */
  hostHandle?: () => string | undefined;
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
  /** conversación natural: cuándo se le respondió a cada viewer, cuándo se le atendió charla, y los límites */
  private lastReplyTo = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  private chatTimes: number[] = [];
  private chatCount = 0;
  private prizes = new Map<string, Credit>();
  /** lo último que dijo el agente (solo en memoria; ADR 0026) y cuándo le contestó por última vez al dueño */
  private history: { name: string; question: string; answer: string }[] = [];
  private lastHostAnswerAt = -Infinity;
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

  /**
   * «Parar IA» (ADR 0024, §7): corta lo que se está respondiendo y vacía la cola. Devuelve a quien se atendía
   * (para sumarle una falta y aprender de su pregunta), o undefined si el agente estaba libre o era una pregunta del dueño.
   *
   * Con `soft` (la orden por voz, ADR 0026) solo se calla lo que se está diciendo y se saca de la fila a quien lo provocó:
   * el resto del chat sigue esperando y, tras un respiro, el agente continúa como lo haría una persona.
   */
  stop(opts: { soft?: boolean } = {}): { name: string; handle: string; question: string } | undefined {
    const cur = this.current;
    const src = this.currentSrc;
    if (opts.soft) {
      this.queue = this.queue.filter((w) => w.host || !src || w.handle !== src.handle);
      this.nextFreeAt = Math.max(this.nextFreeAt, this.now() + SOFT_STOP_PAUSE_MS);
    } else {
      this.queue = [];
      this.nextFreeAt = 0;
    }
    this.current = undefined;
    this.currentSrc = undefined;
    this.notices = [];
    this.emit("state");
    return cur && src && !src.host ? { name: cur.name, handle: src.handle, question: cur.question } : undefined;
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
    this.lastReplyTo.clear();
    this.lastChatAt.clear();
    this.chatTimes = [];
    this.chatCount = 0;
    this.coinStreaks.clear();
    this.notices = [];
    this.pendingFollows = [];
    this.lastGiftThanks.clear();
    this.answered = 0;
    this.history = [];
    this.lastHostAnswerAt = -Infinity;
    this.lastError = undefined;
    this.reset();
  }

  /** Premio de la trivia: la próxima pregunta de esta persona pasa primero (aunque no cumpla los requisitos) y se salta su espera. */
  grantPrize(handle: string, coins: number): void {
    const key = handleKey(handle);
    this.prizes.set(key, { coins, until: this.now() + this.config.giftCreditMin * 60_000 });
    this.lastAsk.delete(key);
  }

  /** ¿Hay una respuesta en pantalla? */
  isAnswering(): boolean {
    return this.current !== undefined;
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

  /**
   * El dueño del LIVE le habla al agente (voz o chat; ADR 0026): es su mano derecha, así que no pide requisitos, no espera su turno
   * ni cuenta contra los topes de la charla. Pasa antes que todo lo demás. Si el agente está ocupado con el chat no lo corta:
   * termina lo que dice, avisa con un «un momento» y lo atiende justo después.
   */
  askHost(name: string, question: string): boolean {
    if (!this.config.enabled) return false;
    const text = clamp(question.trim(), Math.max(this.config.maxQuestionChars, 300));
    if (!text) return false;
    if (this.queue.some((w) => w.host && w.question === text)) return false;
    if (this.queue.filter((w) => w.host).length >= HOST_MAX_QUEUE) return false;
    const handle = this.opts.hostHandle?.() || "@anfitrion";
    const busy = this.current !== undefined || this.opts.paused?.() === true;
    if (!this.enqueue(handle, name, undefined, text, 0, false, true)) return false;
    if (busy) this.holdHost(name);
    return true;
  }

  /** ¿Le habló el dueño hace poco (o se le acaba de responder)? Entonces lo siguiente que diga suele seguir la conversación. */
  hostFollowUp(): boolean {
    return this.now() - this.lastHostAnswerAt < HOST_FOLLOWUP_MS;
  }

  /** Lo último que dijo el agente, una línea por respuesta, para el prompt (solo en memoria; se borra al empezar otro LIVE). */
  answersContext(n = 4): string {
    return this.history
      .slice(-n)
      .map((h) => `${h.name} preguntó «${clamp(h.question, 160)}» y dijiste «${clamp(h.answer, 220)}»`)
      .join("\n");
  }

  /** «Un momento»: el agente está ocupado y el dueño le habló; se lo dice en pantalla y en voz, sin pasar por el modelo. */
  private holdHost(name: string): void {
    const line = HOST_WAIT_LINES[Math.min(HOST_WAIT_LINES.length - 1, Math.floor(this.random() * HOST_WAIT_LINES.length))]!;
    this.pushNotice("queue", line.replace("{n}", niceName(name) || "jefe"), true, "calm", true);
    this.emit("state");
  }

  /** Mensaje del dueño en el chat de TikTok: solo es para el agente si lo nombra, usa el comando o sigue una charla reciente. */
  private hostComment(name: string, evt: LiveEvent): void {
    const text = (evt.text ?? "").trim();
    if (!text) return;
    const command = parseAgentCommand(this.config.command, text);
    if (command !== undefined) {
      if (command) this.askHost(name, command);
      return;
    }
    if (mentions(text, this.config.name) || this.hostFollowUp()) this.askHost(name, text);
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
    if (this.opts.isHost?.(handle)) {
      this.hostComment(name, evt);
      return;
    }
    const question = parseAgentCommand(this.config.command, evt.text);
    if (question === undefined) {
      this.maybeChat(handle, name, evt);
      return;
    }
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

  /**
   * Conversación natural (ADR 0024, §5): charla sin comando. Un filtro local, sin modelo, decide si vale la pena: solo si lo nombran
   * o si quien habla acaba de recibir respuesta suya (hace menos de un minuto). Respeta quién puede preguntar, la espera por viewer,
   * el tope por minuto y por LIVE, y nunca llena la fila (las preguntas de verdad van antes).
   */
  private maybeChat(handle: string, name: string, evt: LiveEvent): void {
    const c = this.config.conversation;
    if (!c.enabled || !this.config.enabled || this.opts.isIgnored?.(handle)) return;
    const text = clamp((evt.text ?? "").trim(), this.config.maxQuestionChars);
    if (text.length < 3) return;
    const t = this.now();
    const replied = this.lastReplyTo.get(handle);
    const followUp = replied !== undefined && t - replied < FOLLOWUP_MS;
    if (!followUp && !mentions(text, this.config.name)) return;
    if (!this.eligible(handle, this.activeCredit(handle) + this.activePrize(handle))) return;
    const last = this.lastChatAt.get(handle);
    if (last !== undefined && t - last < c.viewerCooldownSec * 1000) return;
    this.chatTimes = this.chatTimes.filter((x) => t - x < 60_000);
    if (this.chatTimes.length >= c.perMinute || this.chatCount >= c.maxCalls) return;
    if (this.queue.length >= CHAT_MAX_QUEUE) return; // la charla espera: no llena la fila
    if (!this.enqueue(handle, name, evt.avatarUrl, text, 0, true)) return;
    this.chatTimes.push(t);
    this.chatCount++;
    this.lastChatAt.set(handle, t);
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
    // la charla que lleva mucho esperando ya no viene a cuento
    if (this.queue.some((w) => w.casual && t - w.at > CHAT_STALE_MS)) {
      this.queue = this.queue.filter((w) => !(w.casual && t - w.at > CHAT_STALE_MS));
      this.emit("state");
    }
    if (this.current || !this.config.enabled) return;
    if (this.opts.paused?.()) return; // trivia en curso: la cola espera y se retoma al terminar
    if (!this.tip && this.config.tips.enabled && t >= this.nextTipAt && this.queue.length === 0 && (this.opts.canShowTip?.() ?? true)) {
      this.showTip();
      return;
    }
    const next = this.pickNext(t);
    if (!next) return;
    this.queue = this.queue.filter((w) => w !== next);
    if (next.coins === 0 && !next.host) this.nextFreeAt = t + this.config.freeEverySec * 1000;
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
      reply = await this.responder(cur.question, { name: cur.name, ...(this.currentSrc?.handle ? { handle: this.currentSrc.handle } : {}), config: this.config, ...(this.currentSrc?.casual ? { chat: true } : {}), ...(this.currentSrc?.host ? { host: true } : {}) });
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
    if (this.currentSrc?.handle) this.lastReplyTo.set(this.currentSrc.handle, this.now());
    if (this.currentSrc?.host) this.lastHostAnswerAt = this.now();
    this.history.push({ name: cur.name, question: cur.question, answer: cur.answer });
    while (this.history.length > HISTORY_MAX) this.history.shift();
    this.emit("state");
  }

  private pickNext(t: number): Waiting | undefined {
    const host = this.queue.find((w) => w.host);
    if (host) return host; // el dueño del LIVE siempre primero, sin esperar el turno de las gratis
    const paid = this.ordered().find((w) => w.coins > 0);
    if (paid) return paid;
    if (t < this.nextFreeAt || this.queue.length === 0) return undefined;
    // primero las preguntas con comando; la charla del chat solo cuando no hay otra cosa
    const pool = this.queue.some((w) => !w.casual) ? this.queue.filter((w) => !w.casual) : this.queue;
    return pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
  }

  /** Orden en que se atenderán: primero las de regalo (más monedas antes), luego las gratis por llegada. */
  private ordered(): Waiting[] {
    return [...this.queue].sort((a, b) => Number(b.host === true) - Number(a.host === true) || b.coins - a.coins || a.seq - b.seq);
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

  private enqueue(handle: string, name: string, avatarUrl: string | undefined, question: string, coins: number, casual = false, host = false): boolean {
    if (!host) {
      if (this.opts.isIgnored?.(handle)) return false;
      if (this.queue.some((w) => w.handle === handle)) return false;
      if (this.queue.length >= this.config.maxQueue) return false;
    }
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
      ...(casual ? { casual: true } : {}),
      ...(host ? { host: true } : {}),
    });
    if (host) {
      this.emit("state");
      return true;
    }
    if (!casual) this.noticeQueued(handle, name, coins);
    this.opts.onQuestion?.(handle, name, question);
    this.emit("state");
    return true;
  }

  // ---- avisos a cada persona ----------------------------------------------

  /** Aviso del propio agente (p. ej. «lo dejé anotado para preguntárselo»): sale en la barra y se lee en voz alta. */
  announce(text: string): void {
    this.pushNotice("queue", text.slice(0, 200), true, "calm");
    this.emit("state");
  }

  /** Pone un aviso a la vista unos segundos. `speak` pide leerlo en voz alta (si está permitido y no hay otro leído hace poco). */
  private pushNotice(kind: AgentNotice["kind"], text: string, speak: boolean, mood: AgentNotice["mood"] = "happy", force = false): void {
    if (!force && !this.config.tips.personal) return;
    const t = this.now();
    const spoken = speak && (force || (this.config.tips.speakThanks && t - this.lastSpokenAt >= SPEAK_GAP_MS));
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
