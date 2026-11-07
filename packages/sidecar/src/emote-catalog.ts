import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WebSocket } from "ws";
import {
  EmoteCatalogEntrySchema,
  EmoteCatalogMessageSchema,
  type EmoteCatalogEntry,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Catálogo de stickers y emotes (ADR 0018). No hay catálogo de dónde sembrarlo ni
 * una API pública para pedir los del streamer: se llena de forma incremental con
 * los que llegan por eventos reales del LIVE (el mensaje trae id e imagen). Nunca
 * se borra automáticamente.
 */

export function defaultEmoteCatalogFilePath(): string {
  return join(appDataDir(), "emote-catalog.json");
}

const SCENE_LABEL = { subscriber: "Super Fan / suscripción", fanClub: "Club de fans" } as const;

/** Cada cuánto se guarda en disco el solo aumento del contador (sin entradas nuevas). */

export class EmoteCatalogStore {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  /** Carga el catálogo. Sin archivo (primer arranque) o corrupto devuelve []. */
  load(): EmoteCatalogEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      }
      return [];
    }
    if (raw.trim() === "") return [];
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.filePath}; se ignora: ${(err as Error).message}`);
      return [];
    }
    const parsed = EmoteCatalogEntrySchema.array().safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("emote-catalog.json con formato inválido; se ignora.");
      return [];
    }
    return parsed.data;
  }

  async save(entries: EmoteCatalogEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}

/** Expone el catálogo por el canal WS `emote-catalog` (patrón `get-state`) y lo guarda en disco. */
export class EmoteCatalogController extends EventEmitter {
  private entries: EmoteCatalogEntry[];

  constructor(private server: StreamTokWsServer, private store: EmoteCatalogStore) {
    super();
    this.entries = this.store.load();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("emote-catalog", (payload, socket) => {
      const parsed = EmoteCatalogMessageSchema.safeParse(payload);
      if (parsed.success && parsed.data.kind === "get-state") this.sendStateTo(socket);
    });
    this.emit("log", {
      level: "info",
      message: `Catálogo de stickers y emotes cargado: ${this.entries.length}`,
    });
  }

  getEntries(): EmoteCatalogEntry[] {
    return this.entries;
  }

  /**
   * Registra un sticker/emote que llegó por un evento real. El id es la clave: si ya
   * está, no se agrega ni se cuenta nada; solo se refresca la imagen y el origen si
   * TikTok mandó otros (las URLs de imagen pueden cambiar). Devuelve true si el catálogo
   * cambió (entrada nueva, otra imagen u otro origen).
   */
  learn(entry: EmoteCatalogEntry): boolean {
    const idx = this.entries.findIndex((e) => e.id === entry.id);
    if (idx === -1) {
      this.entries.push({ ...entry, count: 1 });
      this.persistAndBroadcast();
      this.emit("log", {
        level: "info",
        message: `Sticker/emote aprendido: ${entry.id} (${SCENE_LABEL[entry.scene]}; código de TikTok ${entry.sceneCode ?? "?"})`,
      });
      return true;
    }
    const current = this.entries[idx];
    const imageChanged = !!entry.imageUrl && entry.imageUrl !== current.imageUrl;
    const sceneChanged = entry.scene !== current.scene;
    if (!imageChanged && !sceneChanged) return false; // ya existe: no se hace nada
    this.entries[idx] = {
      ...current,
      scene: entry.scene,
      sceneCode: entry.sceneCode ?? current.sceneCode,
      imageUrl: entry.imageUrl ?? current.imageUrl,
    };
    this.persistAndBroadcast();
    return true;
  }

  private persistAndBroadcast() {
    this.broadcastState();
    void this.store.save(this.entries).catch((err) => {
      this.emit("log", {
        level: "error",
        message: "No se pudo guardar el catálogo de stickers y emotes",
        details: err,
      });
    });
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "emote-catalog", { kind: "state", emotes: this.entries });
  }

  private broadcastState() {
    this.server.broadcast("emote-catalog", { kind: "state", emotes: this.entries });
  }
}
