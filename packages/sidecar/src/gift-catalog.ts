import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WebSocket } from "ws";
import {
  GiftCatalogEntrySchema,
  GiftCatalogMessageSchema,
  type GiftCatalogEntry,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";
import giftCatalogSeed from "./data/gift-catalog-seed.json" with { type: "json" };

/**
 * Catálogo de regalos (issue #35). Se siembra en el primer arranque desde un
 * catálogo estático (solo nombre/imagen/costo, sin id) y se va enriqueciendo de
 * forma incremental con los regalos que llegan por eventos reales del LIVE
 * (que sí traen id). Nunca se borra automáticamente.
 */

export function defaultGiftCatalogFilePath(): string {
  return join(appDataDir(), "gift-catalog.json");
}

/** Normaliza un nombre para matchear: trim + lowercase + sin tildes/diacríticos. */
export function normalizeGiftName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class GiftCatalogStore {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  /** Carga el catálogo desde disco. Si no existe (primer arranque), siembra
   * desde el catálogo estático. Ante archivo corrupto devuelve []. */
  load(): GiftCatalogEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return this.seedFromStatic();
      }
      this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
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
    const parsed = GiftCatalogEntrySchema.array().safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("gift-catalog.json con formato inválido; se ignora.");
      return [];
    }
    return parsed.data;
  }

  /** Siembra desde el catálogo estático (sin id) y lo persiste. */
  private seedFromStatic(): GiftCatalogEntry[] {
    const parsed = GiftCatalogEntrySchema.array().safeParse(giftCatalogSeed);
    if (!parsed.success) {
      this.onWarn?.("gift-catalog-seed.json con formato inválido; se inicia vacío.");
      return [];
    }
    const entries = parsed.data;
    void this.save(entries).catch((err) => {
      this.onWarn?.(`No se pudo persistir la semilla del catálogo: ${(err as Error).message}`);
    });
    return entries;
  }

  async save(entries: GiftCatalogEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}

/**
 * Expone el catálogo por el canal WS `gift-catalog` (patrón `get-state` como
 * profiles.ts) y lo mantiene sincronizado en disco.
 */
export class GiftCatalogController extends EventEmitter {
  private entries: GiftCatalogEntry[];

  constructor(private server: StreamTokWsServer, private store: GiftCatalogStore) {
    super();
    this.entries = this.store.load();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("gift-catalog", (payload, socket) => {
      const parsed = GiftCatalogMessageSchema.safeParse(payload);
      if (parsed.success && parsed.data.kind === "get-state") this.sendStateTo(socket);
    });
    this.emit("log", { level: "info", message: `Catálogo de regalos cargado: ${this.entries.length} regalos` });
  }

  getEntries(): GiftCatalogEntry[] {
    return this.entries;
  }

  /** Aprende un regalo que llegó por un evento real. Devuelve true si el
   * catálogo cambió (se agregó o se confirmó el id de una entrada sembrada). */
  learn(entry: GiftCatalogEntry): boolean {
    // 1. Match por id (prioridad): si ya hay una entrada con ese id, no hay nada
    //    nuevo que aprender.
    if (entry.id && this.entries.some((e) => e.id === entry.id)) return false;

    // 2. Match por nombre normalizado.
    const target = normalizeGiftName(entry.name);
    const idx = this.entries.findIndex((e) => normalizeGiftName(e.name) === target);
    if (idx !== -1) {
      const existing = this.entries[idx];
      // 3. Upgrade: la entrada sembrada no tenía id y el evento trae el id real
      //    + la imagen real (más confiable que la de BeetGames).
      if (!existing.id && entry.id) {
        this.entries[idx] = { ...existing, id: entry.id, imageUrl: entry.imageUrl };
        this.persistAndBroadcast();
        this.emit("log", { level: "info", message: `Regalo confirmado: ${entry.name} (id ${entry.id})` });
        return true;
      }
      return false;
    }

    // 4. No hay match ni por id ni por nombre: entrada nueva.
    this.entries.push(entry);
    this.persistAndBroadcast();
    this.emit("log", {
      level: "info",
      message: `Regalo aprendido: ${entry.name} (${entry.id ?? "sin id"})`,
    });
    return true;
  }

  private persistAndBroadcast() {
    this.broadcastState();
    void this.store.save(this.entries).catch((err) => {
      this.emit("log", {
        level: "error",
        message: "No se pudo guardar el catálogo de regalos",
        details: err,
      });
    });
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "gift-catalog", { kind: "state", gifts: this.entries });
  }

  private broadcastState() {
    this.server.broadcast("gift-catalog", { kind: "state", gifts: this.entries });
  }
}
