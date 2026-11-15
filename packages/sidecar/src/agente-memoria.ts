import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AgentConfig,
  AgentMemoryFileSchema,
  MAX_CONDUCTAS,
  MAX_PENDIENTES,
  type Pendiente,
  MAX_VIEWERS,
  MAX_VIEWER_FACTS,
  MAX_OPTOUT,
  VIEWER_TTL_DAYS,
  type ViewerFact,
  STRIKE_LIMIT,
  type AgentMemoryFile,
  type Conducta,
  type LiveEvent,
  type StreamerFact,
  type StreamerMemory,
  type ViewerMemory,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";
import { sanitizeQuestion } from "./agente-guard.js";

/**
 * Memoria del agente (ADR 0024, fase 1): ficha del streamer, hechos que él escribe y viewers vistos.
 * No llama a ningún modelo. Lo que escribe un viewer se guarda recortado y se trata siempre como dato.
 *
 * Eventos: `state` (cambió algo), `log` ({level, message}).
 */

export function defaultMemoriaFilePath(): string {
  return join(appDataDir(), "agente-memoria.json");
}

export interface MemoriaStorePort {
  load(): AgentMemoryFile;
  save(data: AgentMemoryFile): Promise<void>;
}

export class MemoriaStore implements MemoriaStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): AgentMemoryFile {
    const defaults = AgentMemoryFileSchema.parse({});
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
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
    const parsed = AgentMemoryFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("agente-memoria.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: AgentMemoryFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, this.filePath);
  }
}

/** Espera antes de escribir el disco tras un cambio, para juntar varios. */
const SAVE_DELAY_MS = 2000;
const RECENT_CHAT = 20;
const FACTS_PREFIX = "Datos del streamer (los escribió él): ";

/** Tope de caracteres de la memoria dentro del prompt (ADR 0024, §6). */
export const MEMORY_PROMPT_BUDGET = 900;

/** Raíces de lo que NUNCA se guarda de una persona (ADR 0024, §4): salud, política, religión, orientación, dinero, domicilio, edad... Red de seguridad local por si el modelo se pasa. */
const SENSITIVE = [
  /\d{6,}/, // teléfonos y números largos
  /\S+@\S+|https?:\/\/|www\./,
  /\b\d{1,2}\s*anos?\b|\banos de edad\b|\bmenor de edad\b|\bcolegio\b|\bescuela\b|\bsecundaria\b|\bprimaria\b/, // edad y escolaridad (posibles menores)
  /enferm|diagnost|depres|ansied|cancer|suicid|terapia|psicolog|psiquiatr|medicament|discapac|embaraz|adicci|trastorno|tdah|autis/,
  /politic|president|partido|votar|voto\b|izquierd|derecha|elecci|gobierno|ideolog/,
  /religi|cristian|catolic|evangel|musulm|judio|ateo|biblia|\bdios\b|iglesia/,
  /\bgay\b|lesbi|bisexual|\btrans\b|transgener|orientacion|sexual|virgen|novi[ao]s? sexual|pareja sexual/,
  /sueldo|salario|gana\s+\d|deuda|dinero|ahorr|pobre|\bricos?\b|prestamo|credito/,
  /direccion|domicilio|\bcalle\b|avenida|jiron|\bmz\b|\blote\b|urbanizacion|vive en el (piso|depa)/,
  /raza|etnia|racial|inmigra|nacionalidad|ciudadan|\bvisa\b|carcel|prision|denunci|delito|policia|arrest/,
];

/** ¿Este dato es de los que no se guardan? (sin tildes ni mayúsculas) */
export function isSensitiveFact(text: string): boolean {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return SENSITIVE.some((re) => re.test(t));
}

/** Ventana de aprendizaje: con tantos viewers con algo nuevo, o pasado este tiempo desde el primero, se manda un lote. */
const LEARN_MIN_VIEWERS = 3;
const LEARN_MAX_WAIT_MS = 5 * 60_000;
const LEARN_LINES = 4;

const handleKey = (username: string | undefined): string => (username ?? "").trim().replace(/^@/, "").toLowerCase();

/** Palabras útiles de una pregunta (sin tildes, sin palabras cortas) para elegir qué hechos del streamer mostrar. */
function keywords(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 4),
  );
}

export class MemoriaService extends EventEmitter {
  private data: AgentMemoryFile;
  private idle: Promise<void> = Promise.resolve();
  private seq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** últimos comentarios del chat (solo en memoria, no se guardan): de aquí sale el ejemplo al aprender con «Parar IA» */
  private recent: { handle: string; name: string; text: string }[] = [];

  constructor(private opts: { store: MemoriaStorePort; now?: () => number }) {
    super();
    this.data = opts.store.load();
    this.pruneInactive();
  }

  /** Olvido automático: los viewers que no se ven en VIEWER_TTL_DAYS días se borran (con sus datos). */
  private pruneInactive(): void {
    const limit = this.now() - VIEWER_TTL_DAYS * 86_400_000;
    for (const [h, v] of Object.entries(this.data.viewers)) {
      if (v.lastSeen > 0 && v.lastSeen < limit) delete this.data.viewers[h];
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  getStreamer(): StreamerMemory {
    return this.data.streamer;
  }

  viewerCount(): number {
    return Object.keys(this.data.viewers).length;
  }

  getViewer(handle: string): ViewerMemory | undefined {
    return this.data.viewers[handleKey(handle)];
  }

  /** El dueño del LIVE sale de la cuenta conectada; si el streamer ya puso otro nombre a mano, se respeta. */
  setOwner(username: string, nickname?: string): void {
    const handle = handleKey(username);
    if (!handle) return;
    const s = this.data.streamer;
    let changed = false;
    if (s.handle !== handle) {
      s.handle = handle;
      changed = true;
    }
    if (!s.name && nickname?.trim()) {
      s.name = nickname.trim().slice(0, 60);
      changed = true;
    }
    if (changed) this.changed();
  }

  saveStreamer(name: string, aliases: string[]): void {
    this.data.streamer.name = name.trim().slice(0, 60);
    this.data.streamer.aliases = [...new Set(aliases.map((a) => a.trim()).filter(Boolean))].slice(0, 10);
    this.changed();
  }

  addFact(text: string): StreamerFact | null {
    const clean = text.trim().slice(0, 300);
    if (!clean || this.data.streamer.facts.length >= 100) return null;
    if (this.data.streamer.facts.some((f) => f.text.toLowerCase() === clean.toLowerCase())) return null;
    const fact: StreamerFact = { id: `f${this.now().toString(36)}${(++this.seq).toString(36)}`, text: clean, at: this.now() };
    this.data.streamer.facts.push(fact);
    this.changed();
    return fact;
  }

  removeFact(id: string): boolean {
    const before = this.data.streamer.facts.length;
    this.data.streamer.facts = this.data.streamer.facts.filter((f) => f.id !== id);
    if (this.data.streamer.facts.length === before) return false;
    this.changed();
    return true;
  }

  clearViewers(): void {
    this.data.viewers = {};
    this.changed();
  }

  /** Cualquier evento del chat o de regalos pone o actualiza al viewer (nombre y última vez). */
  handleLiveEvent(evt: LiveEvent): void {
    const handle = handleKey(evt.username);
    if (!handle || handle === this.data.streamer.handle) return;
    const name = (evt.nickname?.trim() || handle).slice(0, 60);
    if (evt.event === "comment" && /^!olv[ií]dame$/i.test((evt.text ?? "").trim())) {
      this.forgetViewer(handle, name);
      return;
    }
    if (this.optedOut(handle)) return;
    if (evt.event === "comment" && evt.text?.trim()) {
      this.recent.push({ handle, name, text: sanitizeQuestion(evt.text).slice(0, 160) });
      while (this.recent.length > RECENT_CHAT) this.recent.shift();
    }
    const v = this.touch(handle, name);
    v.lastSeen = this.now();
    this.dirty();
  }

  /** Últimos comentarios del chat, del más viejo al más nuevo (contexto reciente; no se guarda). */
  recentChat(n = 10): { name: string; text: string }[] {
    return this.recent.slice(-n).map(({ name, text }) => ({ name, text }));
  }

  // ---- datos de los viewers aprendidos con el modelo (ADR 0024, §4) ----------------------

  /** lo que dijo cada viewer al agente desde el último lote (solo en memoria) */
  private learnBuffer = new Map<string, { name: string; lines: string[]; since: number }>();

  private optedOut(key: string): boolean {
    return this.data.optOut.includes(key);
  }

  /** ¿Toca mandar un lote al modelo? */
  learnReady(): boolean {
    if (this.learnBuffer.size === 0) return false;
    if (this.learnBuffer.size >= LEARN_MIN_VIEWERS) return true;
    const oldest = Math.min(...[...this.learnBuffer.values()].map((x) => x.since));
    return this.now() - oldest >= LEARN_MAX_WAIT_MS;
  }

  /** Saca (y vacía) lo pendiente de aprender, como mucho `max` viewers. */
  takeLearnBatch(max = 8): { handle: string; name: string; lines: string[] }[] {
    const out: { handle: string; name: string; lines: string[] }[] = [];
    for (const [handle, x] of this.learnBuffer) {
      if (out.length >= max) break;
      out.push({ handle, name: x.name, lines: x.lines });
      this.learnBuffer.delete(handle);
    }
    return out;
  }

  /** Guarda lo que el modelo aprendió de un viewer: sin lo sensible, sin repetidos y con tope (el más viejo cede el sitio). */
  addViewerFacts(handle: string, facts: string[]): number {
    const key = handleKey(handle);
    const v = this.data.viewers[key];
    if (!v || this.optedOut(key)) return 0;
    let added = 0;
    for (const raw of facts) {
      const text = sanitizeQuestion(raw).slice(0, 120);
      if (!text || isSensitiveFact(text)) continue;
      if (v.facts.some((f) => f.text.toLowerCase() === text.toLowerCase())) continue;
      const fact: ViewerFact = { id: `v${this.now().toString(36)}${(++this.seq).toString(36)}`, text, at: this.now() };
      v.facts.push(fact);
      while (v.facts.length > MAX_VIEWER_FACTS) v.facts.shift();
      added++;
    }
    if (added > 0) this.changed();
    return added;
  }

  viewersWithFacts(limit = 30): { handle: string; name: string; facts: ViewerFact[] }[] {
    return Object.values(this.data.viewers)
      .filter((v) => v.facts.length > 0)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit)
      .map((v) => ({ handle: v.handle, name: v.name || v.handle, facts: v.facts }));
  }

  removeViewerFact(handle: string, id: string): boolean {
    const v = this.data.viewers[handleKey(handle)];
    if (!v) return false;
    const before = v.facts.length;
    v.facts = v.facts.filter((f) => f.id !== id);
    if (v.facts.length === before) return false;
    this.changed();
    return true;
  }

  removeViewer(handle: string): boolean {
    const key = handleKey(handle);
    if (!this.data.viewers[key]) return false;
    delete this.data.viewers[key];
    this.learnBuffer.delete(key);
    this.changed();
    return true;
  }

  /** «!olvidame»: se borra todo lo del viewer y no se vuelve a aprender nada de él. Emite `forgotten` con su nombre. */
  forgetViewer(handle: string, name: string): void {
    const key = handleKey(handle);
    if (!key) return;
    delete this.data.viewers[key];
    this.learnBuffer.delete(key);
    if (!this.optedOut(key)) {
      this.data.optOut.push(key);
      while (this.data.optOut.length > MAX_OPTOUT) this.data.optOut.shift();
    }
    this.changed();
    this.emit("forgotten", name);
  }

  // ---- preguntas al streamer (ADR 0024, §3) -----------------------------------------------

  /** preguntas hechas al streamer en este LIVE (solo en memoria; cuenta contra `maxStreamerAsks`) */
  private asksThisLive = 0;

  getPendientes(): Pendiente[] {
    return this.data.pendientes;
  }

  asksLeft(max: number): boolean {
    return this.asksThisLive < max;
  }

  /** Anota lo que el agente no supo del streamer. Una misma pregunta no se repite. Devuelve null si ya estaba. */
  addPending(question: string, asker: string): Pendiente | null {
    const q = sanitizeQuestion(question).slice(0, 300);
    if (!q) return null;
    if (this.data.pendientes.some((p) => p.question.toLowerCase() === q.toLowerCase())) return null;
    const p: Pendiente = { id: `p${this.now().toString(36)}${(++this.seq).toString(36)}`, question: q, asker: sanitizeQuestion(asker).slice(0, 60), at: this.now() };
    this.data.pendientes.push(p);
    while (this.data.pendientes.length > MAX_PENDIENTES) this.data.pendientes.shift();
    this.asksThisLive++;
    this.changed();
    return p;
  }

  hasPending(id: string): boolean {
    return this.data.pendientes.some((p) => p.id === id);
  }

  /** El streamer contesta: la respuesta pasa a ser un hecho suyo y la pregunta se cierra. Emite `answered` con la pregunta. */
  answerPending(id: string, text: string): boolean {
    const p = this.data.pendientes.find((x) => x.id === id);
    const answer = text.trim().slice(0, 250);
    if (!p || !answer) return false;
    this.data.pendientes = this.data.pendientes.filter((x) => x.id !== id);
    this.addFact(`Sobre «${p.question.slice(0, 120)}»: ${answer}`.slice(0, 300));
    this.changed();
    this.emit("answered", p);
    return true;
  }

  /** Se descarta (o «No quiero contestar»). Emite `dismissed` con la pregunta y si fue una negativa. */
  dismissPending(id: string, decline: boolean): boolean {
    const p = this.data.pendientes.find((x) => x.id === id);
    if (!p) return false;
    this.data.pendientes = this.data.pendientes.filter((x) => x.id !== id);
    this.changed();
    this.emit("dismissed", p, decline);
    return true;
  }

  // ---- conductas aprendidas y faltas (ADR 0024, §7) --------------------------------------

  getConductas(): Conducta[] {
    return this.data.conductas;
  }

  addConducta(pattern: string, example = ""): Conducta | null {
    const clean = sanitizeQuestion(pattern).slice(0, 200);
    if (!clean) return null;
    const dup = this.data.conductas.find((c) => c.pattern.toLowerCase() === clean.toLowerCase());
    if (dup) return dup;
    if (this.data.conductas.length >= MAX_CONDUCTAS) this.data.conductas.shift(); // la más vieja cede el sitio
    const c: Conducta = { id: `c${this.now().toString(36)}${(++this.seq).toString(36)}`, pattern: clean, example: sanitizeQuestion(example).slice(0, 200), at: this.now() };
    this.data.conductas.push(c);
    this.changed();
    return c;
  }

  removeConducta(id: string): boolean {
    const before = this.data.conductas.length;
    this.data.conductas = this.data.conductas.filter((c) => c.id !== id);
    if (this.data.conductas.length === before) return false;
    this.changed();
    return true;
  }

  /** Suma una falta. Devuelve true si con esta el viewer queda ignorado. */
  addStrike(handle: string): boolean {
    const key = handleKey(handle);
    if (!key || key === this.data.streamer.handle || key.startsWith("prueba-") || key.startsWith("@prueba-")) return false;
    const v = this.touch(key, this.data.viewers[key]?.name || key);
    v.strikes++;
    const becameIgnored = !v.ignored && v.strikes >= STRIKE_LIMIT;
    if (becameIgnored) {
      v.ignored = true;
      this.emit("log", { level: "warn", message: `Se ignora a ${v.name || v.handle} el resto del LIVE (${v.strikes} intentos de manipular al agente). Puedes perdonarlo en Memoria del agente.` });
    }
    this.changed();
    return becameIgnored;
  }

  isIgnored(handle: string): boolean {
    return this.data.viewers[handleKey(handle)]?.ignored === true;
  }

  ignoredViewers(): { handle: string; name: string; strikes: number }[] {
    return Object.values(this.data.viewers)
      .filter((v) => v.ignored)
      .map((v) => ({ handle: v.handle, name: v.name || v.handle, strikes: v.strikes }));
  }

  /** El streamer perdona: sin faltas y ya se le atiende. */
  forgive(handle: string): void {
    const v = this.data.viewers[handleKey(handle)];
    if (!v) return;
    v.ignored = false;
    v.strikes = 0;
    this.changed();
  }

  /** LIVE nuevo: las faltas y los ignorados empiezan de cero (las conductas aprendidas se conservan). */
  resetSession(): void {
    let any = false;
    for (const v of Object.values(this.data.viewers)) {
      if (v.strikes > 0 || v.ignored) {
        v.strikes = 0;
        v.ignored = false;
        any = true;
      }
    }
    this.recent = [];
    this.asksThisLive = 0;
    this.pruneInactive();
    if (any) this.changed();
  }

  /** El viewer hizo una pregunta al agente. */
  noteQuestion(handle: string, name: string, question: string): void {
    const key = handleKey(handle);
    if (!key || key.startsWith("prueba-") || key.startsWith("@prueba-")) return;
    if (this.optedOut(key)) return;
    const v = this.touch(key, name.slice(0, 60));
    // lo que el viewer le dice al agente es lo único de lo que aprende (nunca todo el chat)
    const buf = this.learnBuffer.get(key) ?? { name: name.slice(0, 60), lines: [], since: this.now() };
    buf.lines.push(sanitizeQuestion(question).slice(0, 200));
    while (buf.lines.length > LEARN_LINES) buf.lines.shift();
    this.learnBuffer.set(key, buf);
    v.questions++;
    v.lastQuestion = sanitizeQuestion(question).slice(0, 200);
    v.lastSeen = this.now();
    this.dirty();
  }

  private touch(handle: string, name: string): ViewerMemory {
    let v = this.data.viewers[handle];
    if (!v) {
      if (this.viewerCount() >= MAX_VIEWERS) this.evictOldest();
      const t = this.now();
      v = { handle, name, firstSeen: t, lastSeen: t, questions: 0, lastQuestion: "", strikes: 0, ignored: false, facts: [] };
      this.data.viewers[handle] = v;
    } else if (name && name !== handle) {
      v.name = name;
    }
    return v;
  }

  private evictOldest(): void {
    let oldest: string | undefined;
    for (const [h, v] of Object.entries(this.data.viewers)) {
      if (oldest === undefined || v.lastSeen < (this.data.viewers[oldest]?.lastSeen ?? Infinity)) oldest = h;
    }
    if (oldest) delete this.data.viewers[oldest];
  }

  /**
   * Texto con lo que el agente sabe, listo para el prompt, dentro de un presupuesto de caracteres:
   * quién es el dueño del LIVE (como dato, sin reglas por nombre), los hechos del streamer que tocan la pregunta
   * y quién pregunta. Devuelve "" si no hay nada que decir.
   */
  contextFor(question: string, askerHandle?: string, budget = MEMORY_PROMPT_BUDGET): string {
    const s = this.data.streamer;
    const parts: string[] = [];
    if (s.name || s.handle) {
      const names = [s.name, ...s.aliases].filter(Boolean).join(", ");
      parts.push(
        `Dueño del LIVE: ${sanitizeQuestion(names || s.handle)}${s.handle ? ` (@${s.handle})` : ""}. Si alguien pregunta por «el streamer», «el dueño» o por ese nombre, se refiere a esta persona.`,
      );
    }
    if (this.data.conductas.length > 0) {
      // lo aprendido con «Parar IA» va antes que los datos del streamer: es seguridad, no adorno
      const list: string[] = [];
      let size = 0;
      for (const c of [...this.data.conductas].reverse()) {
        const line = sanitizeQuestion(c.pattern);
        if (size + line.length > Math.floor(budget * 0.45)) break;
        list.push(line);
        size += line.length + 3;
      }
      if (list.length > 0) parts.push(`Conductas que el streamer te pidió evitar (las marcó él): ${list.join(" | ")}.`);
    }
    if (s.facts.length > 0) {
      const words = keywords(question);
      const scored = s.facts
        .map((f, i) => ({ f, i, score: [...keywords(f.text)].filter((w) => words.has(w)).length }))
        .sort((a, b) => b.score - a.score || b.f.at - a.f.at || a.i - b.i);
      const chosen: string[] = [];
      let used = parts.join(" ").length + FACTS_PREFIX.length + 1;
      for (const { f } of scored) {
        const line = sanitizeQuestion(f.text);
        if (used + line.length + 3 > budget) break;
        chosen.push(line);
        used += line.length + 3;
      }
      if (chosen.length > 0) parts.push(`${FACTS_PREFIX}${chosen.join(" | ")}.`);
    }
    const v = askerHandle ? this.getViewer(askerHandle) : undefined;
    if (v && v.questions > 0) {
      parts.push(`Quien pregunta: ${sanitizeQuestion(v.name || v.handle)}, ya ha hecho ${v.questions} pregunta${v.questions === 1 ? "" : "s"}.`);
    } else if (v?.name) {
      parts.push(`Quien pregunta: ${sanitizeQuestion(v.name)}.`);
    }
    if (v && v.facts.length > 0) {
      // lo que esa persona contó de sí misma: dato para tratarla con cercanía, no para sacarlo a relucir sin venir a cuento
      parts.push(`Lo que esa persona ha contado de sí misma: ${v.facts.slice(-3).map((f) => sanitizeQuestion(f.text)).join(" | ")}.`);
    }
    return parts.join(" ").slice(0, budget);
  }

  /** Guarda ya lo pendiente y espera a que terminen las escrituras (para pruebas y para cerrar). */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.writeNow();
    }
    return this.idle;
  }

  private changed(): void {
    this.dirty();
    this.emit("state");
  }

  /** Los cambios se juntan: un LIVE con mucho chat no escribe el disco en cada mensaje. */
  private dirty(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeNow();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  private writeNow(): void {
    const snapshot: AgentMemoryFile = structuredClone(this.data);
    this.idle = this.idle
      .then(() => this.opts.store.save(snapshot))
      .catch((err) => {
        this.emit("log", { level: "error", message: `No se pudo guardar agente-memoria.json: ${(err as Error).message}` });
      });
  }
}

/**
 * «Parar IA» (ADR 0024, §7): a quien se atendía se le suma una falta y, con los últimos comentarios del chat y su pregunta,
 * el modelo describe el patrón para guardarlo como conducta a evitar. Sin modelo (sin clave o sin llamadas) se guarda el
 * propio mensaje como ejemplo. Si el modelo no ve nada raro, no se aprende nada.
 */
export async function learnFromStop(
  memoria: MemoriaService,
  model: { describeBehavior(lines: string[], config: AgentConfig): Promise<string | null> },
  config: AgentConfig,
  stopped: { name: string; handle: string; question: string } | undefined,
): Promise<Conducta | null> {
  if (stopped?.handle) memoria.addStrike(stopped.handle);
  const chat = memoria.recentChat(10).map((m) => `${m.name}: ${m.text}`);
  const lines = stopped ? [...chat, `${stopped.name} (pregunta al agente): ${stopped.question}`] : chat;
  if (lines.length === 0) return null;
  const example = stopped?.question || chat[chat.length - 1] || "";
  const pattern = await model.describeBehavior(lines, config);
  if (pattern === "") return null;
  return memoria.addConducta(pattern ?? `Mensajes como: «${sanitizeQuestion(example).slice(0, 120)}»`, example);
}
