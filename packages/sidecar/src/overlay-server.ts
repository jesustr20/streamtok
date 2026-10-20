import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { audioTestPage } from "./audio-test-page.js";
import { OVERLAY_DEFAULT_PORT, overlayPage, type OverlayKind } from "@streamtok/shared";

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
}

export function overlayPortFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env.STREAMTOK_OVERLAY_PORT);
  return Number.isInteger(n) && n >= 0 && n <= 65535 && env.STREAMTOK_OVERLAY_PORT ? n : OVERLAY_DEFAULT_PORT;
}

const KINDS: OverlayKind[] = ["timer", "wins", "meta", "nivel", "duelo"];

/** `/overlay/<tipo>` o `/overlay/<tipo>/<id>` (el id solo lo usan los tipos con varias instancias: `meta`, `nivel` y `duelo`). */
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

  constructor(opts: OverlayHttpServerOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? OVERLAY_DEFAULT_PORT;
    this.wsPort = opts.wsPort;
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
    const target = parsePath(pathname);
    if (!target) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }
    const html = overlayPage(target.kind, this.wsPort, target.kind === "meta" || target.kind === "nivel" || target.kind === "duelo" ? { id: target.id } : {});
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(method === "HEAD" ? undefined : html);
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
