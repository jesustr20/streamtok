import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import { parseTriviaAnswer, type AgentConfig, type AgentTriviaState, type LiveEvent } from "@streamtok/shared";
import { looksLikeInjection } from "./agente-guard.js";

/**
 * Trivia del agente (ADR 0016, fase b). Cuando el chat está tranquilo el agente lanza una pregunta
 * con opciones; la gente responde con la letra (A, B, C, D); el primero que acierta gana (premio:
 * su próxima pregunta al agente pasa primero, y suma un acierto al Top Trivia).
 *
 * La respuesta correcta vive solo aquí: el estado que sale al overlay no la trae hasta que se enseña.
 * Eventos: `state` (cambió algo), `log` ({level, message}).
 */

export interface TriviaQuestion {
  question: string;
  options: string[];
  /** índice de la opción correcta dentro de `options` */
  correct: number;
}

/** Pide una pregunta nueva (al modelo). Devuelve null si no se pudo. */
export type TriviaGenerator = (config: AgentConfig, recent: string[]) => Promise<TriviaQuestion | null>;

export interface TriviaWinner {
  handle: string;
  name: string;
  avatarUrl?: string;
}

/** Cuánto se queda la respuesta en pantalla. */
export const REVEAL_MS = 15_000;
/** Si el modelo falla, espera tanto antes de reintentar solo. */
const RETRY_AFTER_MS = 60_000;
/** Cuántas preguntas recientes se le dicen al modelo para que no las repita (el resto se filtra aquí). */
const RECENT_FOR_PROMPT = 15;

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();

/** Preguntas de ejemplo para probar sin clave ni gasto. */
export const SAMPLE_TRIVIA: TriviaQuestion[] = [
  { question: "¿Cuál es el planeta más grande del sistema solar?", options: ["Saturno", "Júpiter", "Neptuno", "Tierra"], correct: 1 },
  { question: "¿Cuál es la capital de Australia?", options: ["Sídney", "Melbourne", "Canberra", "Perth"], correct: 2 },
  { question: "¿Quién pintó la Mona Lisa?", options: ["Leonardo da Vinci", "Miguel Ángel", "Rafael", "Goya"], correct: 0 },
  { question: "¿Cuántos huesos tiene el cuerpo humano adulto?", options: ["186", "206", "226", "256"], correct: 1 },
  { question: "¿En qué año llegó el hombre a la Luna?", options: ["1965", "1969", "1972", "1975"], correct: 1 },
  { question: "¿Cuál es el río más largo de Sudamérica?", options: ["Orinoco", "Paraná", "Amazonas", "Magdalena"], correct: 2 },
  { question: "¿Qué gas respiramos para vivir?", options: ["Nitrógeno", "Oxígeno", "Helio", "Hidrógeno"], correct: 1 },
  { question: "¿Cuántos jugadores hay en un equipo de fútbol en la cancha?", options: ["9", "10", "11", "12"], correct: 2 },
];

const LIMITS = { question: 140, option: 40 };

/** Valida la pregunta que devolvió el modelo (JSON con pregunta, opciones y correcta). Null si algo no cuadra. */
export function parseTrivia(raw: string, optionCount: number): TriviaQuestion | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let json: any;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const clean = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.replace(/https?:\/\/\S+/gi, "").replace(/[<>*_`#]/g, "").replace(/\s+/g, " ").trim();
    return t.length >= 1 && t.length <= max ? t : null;
  };
  const question = clean(json?.pregunta, LIMITS.question);
  if (!question || question.length < 10) return null;
  const opts = json?.opciones;
  if (!Array.isArray(opts) || opts.length !== optionCount) return null;
  const options = opts.map((o) => clean(o, LIMITS.option));
  if (options.some((o) => o === null)) return null;
  const list = options as string[];
  if (new Set(list.map((o) => o.toLowerCase())).size !== list.length) return null;
  const correct = json?.correcta;
  if (!Number.isInteger(correct) || correct < 0 || correct >= optionCount) return null;
  if ([question, ...list].some((t) => looksLikeInjection(t))) return null;
  return { question, options: list, correct };
}

const plain = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ");
const words = (s: string): Set<string> => new Set(plain(s).split(/\s+/).filter((w) => w.length >= 4));

/** ¿Dos preguntas son la misma o casi? (mismo texto, o comparten la mayoría de sus palabras importantes). */
export function similarQuestion(a: string, b: string): boolean {
  if (plain(a).trim() === plain(b).trim()) return true;
  const x = words(a);
  const y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.6;
}

/** Lee un lote de preguntas: `{"preguntas":[...]}` o una lista; descarta las que no cumplen el formato. */
export function parseTriviaBatch(raw: string, optionCount: number): TriviaQuestion[] {
  const start = raw.search(/[\[{]/);
  if (start === -1) return [];
  let json: unknown;
  for (let end = raw.length; end > start; end = Math.max(raw.lastIndexOf("}", end - 1), raw.lastIndexOf("]", end - 1)) + 1) {
    try {
      json = JSON.parse(raw.slice(start, end));
      break;
    } catch {
      /* se recorta hasta el siguiente cierre */
    }
    if (end <= start + 1) break;
  }
  const list = Array.isArray(json) ? json : Array.isArray((json as { preguntas?: unknown })?.preguntas) ? (json as { preguntas: unknown[] }).preguntas : json ? [json] : [];
  const out: TriviaQuestion[] = [];
  for (const item of list) {
    const q = parseTrivia(JSON.stringify(item), optionCount);
    if (q) out.push(q);
  }
  return out;
}

/** Cuántas preguntas se recuerdan entre LIVEs para no repetirlas (ADR 0024, fase 8). */
export const TRIVIA_HISTORY_MAX = 200;

/** Historial de preguntas ya lanzadas, en `agente-trivia.json` (escritura atómica y diferida). */
export class TriviaHistory {
  private list: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();

  constructor(private filePath: string, private onWarn?: (message: string) => void, private delayMs = 2000) {
    try {
      const json = JSON.parse(readFileSync(filePath, "utf8")) as { history?: unknown };
      if (Array.isArray(json.history)) this.list = json.history.filter((x): x is string => typeof x === "string").slice(-TRIVIA_HISTORY_MAX);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") onWarn?.(`No se pudo leer ${filePath}; se empieza sin historial.`);
    }
  }

  all(): string[] {
    return [...this.list];
  }

  add(question: string): void {
    this.list.push(question.slice(0, 200));
    while (this.list.length > TRIVIA_HISTORY_MAX) this.list.shift();
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.saving = this.saving.then(async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await writeFile(tmp, JSON.stringify({ history: this.list }), "utf8");
        await rename(tmp, this.filePath);
      } catch (err) {
        this.onWarn?.(`No se pudo guardar ${this.filePath}: ${(err as Error).message}`);
      }
    });
    return this.saving;
  }
}

export interface TriviaEngineOptions {
  generator: TriviaGenerator;
  /** preguntas ya lanzadas, guardadas entre LIVEs (si falta, solo se recuerdan las de esta sesión) */
  history?: TriviaHistory;
  getConfig: () => AgentConfig;
  /** ¿el agente está ocupado respondiendo? Entonces la trivia espera */
  busy?: () => boolean;
  /** ¿hay una respuesta en pantalla? Una trivia lanzada a mano espera a que acabe (no la corta) */
  answering?: () => boolean;
  onWinner?: (winner: TriviaWinner) => void;
  now?: () => number;
  random?: () => number;
}

export class TriviaEngine extends EventEmitter {
  private phase: AgentTriviaState["phase"] = "idle";
  private q: TriviaQuestion | undefined;
  private deadline = 0;
  private startedAt = 0;
  private revealUntil = 0;
  private answers = new Map<string, number>();
  private winner: AgentTriviaState["winner"];
  private lastActivity: number;
  private nextAllowedAt = 0;
  /** trivia lanzada a mano que espera a que acabe la respuesta en pantalla */
  private pendingStart: { sample: boolean } | undefined;
  private starts: number[] = [];
  private recent: string[] = [];
  private token = 0;
  private now: () => number;
  private random: () => number;

  constructor(private opts: TriviaEngineOptions) {
    super();
    this.now = opts.now ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.lastActivity = this.now();
    this.recent = opts.history?.all() ?? [];
  }

  getState(): AgentTriviaState {
    const open = this.phase === "open" || this.phase === "reveal";
    return {
      phase: this.phase,
      ...(this.q && open ? { question: this.q.question, options: this.q.options } : { options: [] }),
      deadline: this.phase === "open" ? this.deadline : 0,
      answers: this.answers.size,
      ...(this.phase === "reveal" && this.q ? { correct: this.q.correct, tally: this.tally() } : {}),
      ...(this.phase === "reveal" && this.winner ? { winner: this.winner } : {}),
      startedAt: this.startedAt,
    };
  }

  /** Cuánta gente eligió cada opción (una respuesta por persona). */
  private tally(): number[] {
    const out = (this.q?.options ?? []).map(() => 0);
    for (const idx of this.answers.values()) if (idx < out.length) out[idx]++;
    return out;
  }

  /** Lanza una trivia ya (botón de la app). `sample` usa una pregunta de ejemplo. Devuelve false si ya hay una en curso. */
  start(sample = false): boolean {
    if (this.phase !== "idle" || this.pendingStart !== undefined) return false;
    // si el agente está enseñando una respuesta, la trivia espera a que termine en vez de taparla
    if (this.opts.answering?.()) {
      this.pendingStart = { sample };
      this.emit("state");
      return true;
    }
    void this.begin(sample);
    return true;
  }

  /** Cancela la trivia en curso sin premio. */
  cancel(): void {
    this.pendingStart = undefined;
    if (this.phase === "idle") return;
    this.token++;
    this.toIdle();
  }

  /** Nuevo LIVE. */
  resetSession(): void {
    this.cancel();
    this.starts = [];
    this.lastActivity = this.now();
    this.nextAllowedAt = 0;
  }

  handleLiveEvent(evt: LiveEvent): void {
    if (evt.event === "comment" || evt.event === "gift") this.lastActivity = this.now();
    if (evt.event !== "comment" || this.phase !== "open" || !this.q) return;
    const idx = parseTriviaAnswer(evt.text, this.q.options);
    if (idx === undefined || idx >= this.q.options.length) return;
    const handle = handleKey(evt.username);
    if (!handle || this.answers.has(handle)) return; // una respuesta por persona: la primera es la que vale
    this.answers.set(handle, idx);
    if (idx === this.q.correct) {
      this.reveal({ handle, name: evt.nickname?.trim() || evt.username.replace(/^@/, ""), ...(evt.avatarUrl ? { avatarUrl: evt.avatarUrl } : {}) });
    } else this.emit("state");
  }

  /** Avanza el reloj de la trivia. Se llama cada segundo. */
  tick(): void {
    const t = this.now();
    if (this.phase === "open" && t >= this.deadline) this.reveal(undefined);
    else if (this.phase === "reveal" && t >= this.revealUntil) {
      this.toIdle();
      this.nextAllowedAt = Math.max(this.nextAllowedAt, t + this.opts.getConfig().trivia.idleSec * 1000);
    } else if (this.phase === "idle" && this.pendingStart) {
      if (!this.opts.answering?.()) {
        const { sample } = this.pendingStart;
        this.pendingStart = undefined;
        void this.begin(sample);
      }
    } else if (this.phase === "idle") {
      const cfg = this.opts.getConfig();
      if (!cfg.enabled || !cfg.trivia.enabled) return;
      if (this.opts.busy?.()) return;
      if (t - this.lastActivity < cfg.trivia.idleSec * 1000 || t < this.nextAllowedAt) return;
      this.starts = this.starts.filter((s) => t - s < 3_600_000);
      if (this.starts.length >= cfg.trivia.maxPerHour) return;
      void this.begin(false);
    }
  }

  // -------------------------------------------------------------------------

  private async begin(sample: boolean): Promise<void> {
    const token = ++this.token;
    this.phase = "generating";
    this.q = undefined;
    this.answers.clear();
    this.winner = undefined;
    this.startedAt = this.now();
    this.emit("state");
    const cfg = this.opts.getConfig();
    let q: TriviaQuestion | null = null;
    try {
      q = sample ? this.sample() : await this.opts.generator(cfg, this.recent.slice(-RECENT_FOR_PROMPT));
    } catch (err) {
      this.emit("log", { level: "error", message: `No se pudo preparar la trivia: ${(err as Error).message}` });
    }
    if (token !== this.token) return; // se canceló mientras el modelo pensaba
    if (!q) {
      this.toIdle();
      this.nextAllowedAt = this.now() + RETRY_AFTER_MS;
      return;
    }
    const order = shuffle(q.options.map((_, i) => i), this.random);
    this.q = { question: q.question, options: order.map((i) => q!.options[i]), correct: order.indexOf(q.correct) };
    this.recent = [...this.recent, q.question].slice(-TRIVIA_HISTORY_MAX);
    this.opts.history?.add(q.question);
    this.starts.push(this.now());
    this.startedAt = this.now();
    this.deadline = this.now() + cfg.trivia.answerSec * 1000;
    this.phase = "open";
    this.emit("state");
  }

  private sample(): TriviaQuestion {
    const fresh = SAMPLE_TRIVIA.filter((s) => !this.recent.some((r) => similarQuestion(r, s.question)));
    const pool = fresh.length > 0 ? fresh : SAMPLE_TRIVIA;
    const q = pool[Math.floor(this.random() * pool.length)];
    const n = this.opts.getConfig().trivia.options;
    if (q.options.length <= n) return q;
    // con 3 opciones se quita una incorrecta
    const drop = q.options.findIndex((_, i) => i !== q.correct);
    const options = q.options.filter((_, i) => i !== drop);
    return { question: q.question, options, correct: options.indexOf(q.options[q.correct]) };
  }

  private reveal(winner: TriviaWinner | undefined): void {
    this.phase = "reveal";
    this.revealUntil = this.now() + REVEAL_MS;
    this.winner = winner ? { name: winner.name, ...(winner.avatarUrl ? { avatarUrl: winner.avatarUrl } : {}) } : undefined;
    this.emit("state");
    if (winner) this.opts.onWinner?.(winner);
  }

  private toIdle(): void {
    this.phase = "idle";
    this.q = undefined;
    this.winner = undefined;
    this.answers.clear();
    this.deadline = 0;
    this.emit("state");
  }
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
