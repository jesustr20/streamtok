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

/**
 * Catálogo de regalos aprendido (issue #35). Es acumulativo: cada regalo que
 * llega por un evento real del LIVE se agrega una vez (dedupe por `id`) y nunca
 * se borra automáticamente. Persiste en `gift-catalog.json` dentro del mismo
 * app-data que profiles (ver mapping-rules.ts).
 */

export function defaultGiftCatalogFilePath(): string {
  return join(appDataDir(), "gift-catalog.json");
}

export class GiftCatalogStore {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  /** Carga el catálogo desde disco. Ante archivo ausente/corrupto devuelve []. */
  load(): GiftCatalogEntry[] {
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
    const parsed = GiftCatalogEntrySchema.array().safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("gift-catalog.json con formato inválido; se ignora.");
      return [];
    }
    return parsed.data;
  }

  async save(entries: GiftCatalogEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}

/**
 * Expone el catálogo aprendido por el canal WS `gift-catalog` (patrón
 * `get-state` como profiles.ts) y lo mantiene sincronizado en disco.
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

  /** Aprende un regalo nuevo. Devuelve true si se agregó (false si ya estaba). */
  learn(entry: GiftCatalogEntry): boolean {
    if (this.entries.some((e) => e.id === entry.id)) return false;
    this.entries.push(entry);
    this.broadcastState();
    void this.store.save(this.entries).catch((err) => {
      this.emit("log", {
        level: "error",
        message: "No se pudo guardar el catálogo de regalos",
        details: err,
      });
    });
    this.emit("log", { level: "info", message: `Regalo aprendido: ${entry.name} (${entry.id})` });
    return true;
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "gift-catalog", { kind: "state", gifts: this.entries });
  }

  private broadcastState() {
    this.server.broadcast("gift-catalog", { kind: "state", gifts: this.entries });
  }
}
