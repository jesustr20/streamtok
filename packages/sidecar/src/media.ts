import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import {
  MEDIA_MAX_BYTES,
  MediaMessageSchema,
  MediaShowParamsSchema,
  looksLikeMedia,
  mediaKindOf,
  parseMediaUrl,
  sanitizeMediaName,
  type MediaFile,
  type MediaWebItem,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Módulo de medios (ADR 0022): carpeta de imágenes/GIF/videos, enlaces web guardados, canal WS
 * `media` y el comando interno `app.media.show`. El sidecar NO dibuja nada: avisa por el canal y
 * la página `/overlay/pantalla/<n>` muestra el medio.
 */

export function defaultMediaDir(): string {
  return join(appDataDir(), "media");
}

function openInExplorer(dir: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [dir]] : process.platform === "darwin" ? ["open", [dir]] : ["xdg-open", [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export interface MediaControllerOptions {
  dir?: string;
  /** Puerto del servidor HTTP (donde se sirven los archivos en /media/<nombre>). */
  httpPort: () => number;
  /** Para pruebas: reemplaza la apertura del explorador. */
  openFolder?: (dir: string) => void;
}

const WEB_LIST = "enlaces.json";

export class MediaController extends EventEmitter {
  readonly dir: string;
  private openFolderFn: (dir: string) => void;

  constructor(
    private server: StreamTokWsServer,
    private opts: MediaControllerOptions,
  ) {
    super();
    this.dir = opts.dir ?? defaultMediaDir();
    this.openFolderFn = opts.openFolder ?? openInExplorer;
    this.server.on("client-connected", (socket) => this.server.sendTo(socket, "media", this.stateMessage()));
    this.server.onChannel("media", (payload, socket) => {
      const parsed = MediaMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      const msg = parsed.data;
      const fail = (r: { ok: boolean; error?: string }) => {
        if (!r.ok) this.server.sendTo(socket, "media", { kind: "error", message: r.error ?? "Error" });
      };
      switch (msg.kind) {
        case "get-state":
          this.server.sendTo(socket, "media", this.stateMessage());
          break;
        case "upload":
          fail(this.upload(msg.name, msg.data));
          break;
        case "delete":
          fail(this.remove(msg.name));
          break;
        case "add-web":
          fail(this.addWeb(msg.url, msg.name));
          break;
        case "delete-web":
          this.removeWeb(msg.url);
          break;
        case "show": {
          // Botón «Probar» de la UI: pasa por el mismo camino que una Acción.
          const { kind: _kind, ...params } = msg;
          fail(this.applyShow(params));
          break;
        }
        case "open-folder":
          mkdirSync(this.dir, { recursive: true });
          this.openFolderFn(this.dir);
          break;
        default:
          break;
      }
    });
  }

  list(): MediaFile[] {
    if (!existsSync(this.dir)) return [];
    const out: MediaFile[] = [];
    for (const name of readdirSync(this.dir)) {
      const kind = mediaKindOf(name);
      if (!kind) continue;
      try {
        const st = statSync(join(this.dir, name));
        if (st.isFile()) out.push({ name, sizeBytes: st.size, kind });
      } catch {
        // desapareció entre el listado y el stat
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }

  listWeb(): MediaWebItem[] {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, WEB_LIST), "utf8"));
      return Array.isArray(raw)
        ? raw.filter((x): x is MediaWebItem => !!x && typeof x.name === "string" && typeof x.url === "string")
        : [];
    } catch {
      return [];
    }
  }

  private writeWeb(items: MediaWebItem[]) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, WEB_LIST), JSON.stringify(items, null, 2));
  }

  addWeb(rawUrl: string, rawName: string): { ok: true } | { ok: false; error: string } {
    const url = parseMediaUrl(rawUrl);
    if (!url) return { ok: false, error: "Pega una URL válida (https://…) de una imagen, GIF o video." };
    const name = rawName.trim().slice(0, 80) || url.hostname;
    const items = this.listWeb().filter((i) => i.url !== url.href);
    this.writeWeb([...items, { name, url: url.href }]);
    this.emit("log", { level: "info", message: `Enlace web guardado: ${name}` });
    this.broadcastState();
    return { ok: true };
  }

  removeWeb(rawUrl: string) {
    this.writeWeb(this.listWeb().filter((i) => i.url !== rawUrl));
    this.broadcastState();
  }

  /** Ruta absoluta de un archivo de la carpeta, o null si el nombre no es un medio directo de ella. */
  resolveFile(name: string): string | null {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") return null;
    if (!mediaKindOf(name)) return null;
    const full = join(this.dir, name);
    try {
      return statSync(full).isFile() ? full : null;
    } catch {
      return null;
    }
  }

  private uniqueName(name: string): string {
    if (!existsSync(join(this.dir, name))) return name;
    const { name: stem, ext } = parse(name);
    for (let i = 2; i < 1000; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!existsSync(join(this.dir, candidate))) return candidate;
    }
    return `${stem} (${Date.now()})${ext}`;
  }

  upload(rawName: string, dataBase64: string): { ok: true; name: string } | { ok: false; error: string } {
    const name = sanitizeMediaName(rawName);
    if (!name) return { ok: false, error: `"${rawName}": formato no admitido (JPG, PNG, WEBP, AVIF, GIF, MP4, WEBM o MOV).` };
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length === 0) return { ok: false, error: `"${rawName}" está vacío.` };
    if (buf.length > MEDIA_MAX_BYTES) {
      return { ok: false, error: `"${rawName}" pesa más de ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB.` };
    }
    if (!looksLikeMedia(buf, name)) return { ok: false, error: `"${rawName}" no parece un archivo válido de ese tipo.` };
    try {
      mkdirSync(this.dir, { recursive: true });
      const finalName = this.uniqueName(name);
      writeFileSync(join(this.dir, finalName), buf);
      this.emit("log", { level: "info", message: `Medio guardado: ${finalName} (${Math.round(buf.length / 1024)} KB)` });
      this.broadcastState();
      return { ok: true, name: finalName };
    } catch (err) {
      return { ok: false, error: `No se pudo guardar "${rawName}": ${(err as Error).message}` };
    }
  }

  remove(name: string): { ok: true } | { ok: false; error: string } {
    const full = this.resolveFile(name);
    if (!full) return { ok: false, error: `"${name}" no está en la carpeta de medios.` };
    try {
      unlinkSync(full);
      this.emit("log", { level: "info", message: `Medio borrado: ${name}` });
      this.broadcastState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `No se pudo borrar "${name}": ${(err as Error).message}` };
    }
  }

  /** Comando interno `app.media.show` (lo llama el motor de Acciones y el botón «Probar»). */
  applyShow(params: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
    const parsed = MediaShowParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: "Mostrar IMG/GIF/VIDEO: parámetros inválidos (falta el archivo o la URL)." };
    const p = parsed.data;
    if (p.source === "local" && !this.resolveFile(p.file)) {
      return { ok: false, error: `Mostrar IMG/GIF/VIDEO: el archivo "${p.file}" ya no está en la carpeta de medios.` };
    }
    if (p.source === "web" && !parseMediaUrl(p.url)) {
      return { ok: false, error: "Mostrar IMG/GIF/VIDEO: la URL no es válida." };
    }
    this.server.broadcast("media", { kind: "show", ...p });
    return { ok: true };
  }

  private stateMessage() {
    return { kind: "state" as const, files: this.list(), web: this.listWeb(), dir: this.dir, port: this.opts.httpPort() };
  }

  private broadcastState() {
    this.server.broadcast("media", this.stateMessage());
  }
}
