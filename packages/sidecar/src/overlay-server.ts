import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { audioTestPage } from "./audio-test-page.js";
import { MEDIA_MAX_SCREENS, OVERLAY_DEFAULT_PORT, mediaScreenPage, overlayPage, type OverlayKind } from "@streamtok/shared";

/**
 * Servidor HTTP de overlays (ADR 0011). Sirve las páginas que el streamer pega
 * en TikTok LIVE Studio (fuente "Enlace") u OBS (Browser Source). Escucha SOLO
 * en loopback.
 *
 * Probado con LIVE Studio: su lienzo no dibuja una página local si el servidor
 * no responde con `Access-Control-Allow-Private-Network: true` (Private Network
 * Access), así que esas cabeceras van siempre, también en 404 y en el preflight.
 */

export interface OverlayHttpServerOptions {
  port?: number;
  host?: string;
  /** puerto del WS del sidecar al que se conectan las páginas */
  wsPort: number;
  /** Resuelve un archivo de la carpeta de audios (ADR 0019); null si no existe. Sin esto /audios/ responde 404. */
  audioFile?: (name: string) => string | null;
  /** Resuelve un archivo de la carpeta de medios (ADR 0022); null si no existe. Sin esto /media/ responde 404. */
  mediaFile?: (name: string) => string | null;
}

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const AUDIO_TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg" };

export function overlayPortFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env.STREAMTOK_OVERLAY_PORT);
  return Number.isInteger(n) && n >= 0 && n <= 65535 && env.STREAMTOK_OVERLAY_PORT ? n : OVERLAY_DEFAULT_PORT;
}

const KINDS: OverlayKind[] = ["timer", "wins", "meta", "nivel", "duelo", "top", "agente"];

/** `/overlay/<tipo>` o `/overlay/<tipo>/<id>` (el id solo lo usan los tipos con varias instancias: `meta`, `nivel`, `duelo` y `top`). */
function parsePath(pathname: string): { kind: OverlayKind; id: string } | null {
  const m = /^\/overlay\/([a-z]+)(?:\/([^/]*))?\/?$/.exec(pathname);
  if (!m || !(KINDS as string[]).includes(m[1])) return null;
  let id = m[2] ?? "";
  try {
    id = decodeURIComponent(id);
  } catch {
    id = "";
  }
  return { kind: m[1] as OverlayKind, id };
}

export class OverlayHttpServer {
  private server: Server;
  private host: string;
  private port: number;
  private wsPort: number;
  private audioFile?: (name: string) => string | null;
  private mediaFile?: (name: string) => string | null;

  constructor(opts: OverlayHttpServerOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? OVERLAY_DEFAULT_PORT;
    this.wsPort = opts.wsPort;
    this.audioFile = opts.audioFile;
    this.mediaFile = opts.mediaFile;
    this.server = createServer((req, res) => this.handle(req, res));
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Cache-Control", "no-store");

    const method = req.method ?? "GET";
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" });
      res.end();
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (/^\/overlay\/prueba-audio\/?$/.test(pathname)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(method === "HEAD" ? undefined : audioTestPage());
      return;
    }
    // Archivos de la carpeta de audios (ADR 0019): los reproduce la app de escritorio.
    const audioMatch = /^\/audios\/([^/]+)$/.exec(pathname);
    if (audioMatch) {
      let name = "";
      try {
        name = decodeURIComponent(audioMatch[1]);
      } catch {
        name = "";
      }
      const full = this.audioFile?.(name) ?? null;
      const type = full ? AUDIO_TYPES[full.slice(full.lastIndexOf(".")).toLowerCase()] : undefined;
      if (!full || !type) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No encontrado");
        return;
      }
      res.writeHead(200, { "Content-Type": type });
      if (method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(full)
        .on("error", () => res.destroy())
        .pipe(res);
      return;
    }
    // Pantallas de medios (ADR 0022): /overlay/pantalla/<n>
    const screenMatch = /^\/overlay\/pantalla(?:\/(\d+))?\/?$/.exec(pathname);
    if (screenMatch) {
      const n = Number(screenMatch[1] ?? "1");
      if (n < 1 || n > MEDIA_MAX_SCREENS) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No encontrado");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(method === "HEAD" ? undefined : mediaScreenPage(this.wsPort, n));
      return;
    }
    // Archivos de la carpeta de medios (con Range, para que los videos se puedan buscar/reproducir).
    const mediaMatch = /^\/media\/([^/]+)$/.exec(pathname);
    if (mediaMatch) {
      this.serveMedia(req, res, mediaMatch[1], method);
      return;
    }
    const target = parsePath(pathname);
    if (!target) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const html = overlayPage(target.kind, this.wsPort, target.kind === "meta" || target.kind === "nivel" || target.kind === "duelo" || target.kind === "top" || target.kind === "agente" ? { id: target.id } : {});
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(method === "HEAD" ? undefined : html);
  }

  private serveMedia(req: IncomingMessage, res: ServerResponse, rawName: string, method: string) {
    let name = "";
    try {
      name = decodeURIComponent(rawName);
    } catch {
      name = "";
    }
    const full = this.mediaFile?.(name) ?? null;
    const type = full ? MEDIA_TYPES[full.slice(full.lastIndexOf(".")).toLowerCase()] : undefined;
    if (!full || !type) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      start = Math.max(0, start);
      res.writeHead(206, {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
      });
      if (method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(full, { start, end })
        .on("error", () => res.destroy())
        .pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
    if (method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(full)
      .on("error", () => res.destroy())
      .pipe(res);
  }

  /** Empieza a escuchar; devuelve el puerto real (útil con port: 0 en tests). */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve(this.actualPort);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
    });
  }

  get actualPort(): number {
    const addr = this.server.address();
    return addr && typeof addr !== "string" ? (addr as AddressInfo).port : this.port;
  }

  address(): string | undefined {
    const addr = this.server.address();
    return addr && typeof addr !== "string" ? (addr as AddressInfo).address : undefined;
  }
}
