import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentMemoryFileSchema,
  MAX_VIEWERS,
  type AgentMemoryFile,
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
const FACTS_PREFIX = "Datos del streamer (los escribió él): ";

/** Tope de caracteres de la memoria dentro del prompt (ADR 0024, §6). */
export const MEMORY_PROMPT_BUDGET = 900;

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

  constructor(private opts: { store: MemoriaStorePort; now?: () => number }) {
    super();
    this.data = opts.store.load();
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
    const v = this.touch(handle, name);
    v.lastSeen = this.now();
    this.dirty();
  }

  /** El viewer hizo una pregunta al agente. */
  noteQuestion(handle: string, name: string, question: string): void {
    const key = handleKey(handle);
    if (!key || key.startsWith("prueba-") || key.startsWith("@prueba-")) return;
    const v = this.touch(key, name.slice(0, 60));
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
      v = { handle, name, firstSeen: t, lastSeen: t, questions: 0, lastQuestion: "" };
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
