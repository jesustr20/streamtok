import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import {
  AUDIO_EXTENSIONS,
  AUDIO_MAX_BYTES,
  AudioMessageSchema,
  AudioPlayParamsSchema,
  sanitizeAudioName,
  type AudioFile,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Módulo de audio (ADR 0019): carpeta de audios, canal WS `audio` y el comando
 * interno `app.audio.play`. El sidecar NO reproduce nada: avisa por el canal y la
 * app de escritorio suena el archivo (que LIVE Studio captura como audio del PC).
 */

export function defaultAudioDir(): string {
  return join(appDataDir(), "audios");
}

export function hasAudioExtension(name: string): boolean {
  const ext = parse(name).ext.toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** Revisa los primeros bytes: que un .mp3 sea de verdad un mp3, wav u ogg (no un archivo cualquiera renombrado). */
export function looksLikeAudio(buf: Buffer, name: string): boolean {
  const ext = parse(name).ext.toLowerCase();
  if (ext === ".mp3") {
    if (buf.length >= 3 && buf.subarray(0, 3).toString("latin1") === "ID3") return true;
    return buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  }
  if (ext === ".wav") {
    return buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE";
  }
  if (ext === ".ogg") return buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "OggS";
  return false;
}

/** Abre una carpeta en el explorador del sistema. */
function openInExplorer(dir: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [dir]]
      : process.platform === "darwin"
        ? ["open", [dir]]
        : ["xdg-open", [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

export interface AudioControllerOptions {
  dir?: string;
  /** Puerto del servidor HTTP (donde se sirven los archivos en /audios/<nombre>). */
  httpPort: () => number;
  /** Para pruebas: reemplaza la apertura del explorador. */
  openFolder?: (dir: string) => void;
}

export class AudioController extends EventEmitter {
  readonly dir: string;
  private openFolderFn: (dir: string) => void;

  constructor(
    private server: StreamTokWsServer,
    private opts: AudioControllerOptions,
  ) {
    super();
    this.dir = opts.dir ?? defaultAudioDir();
    this.openFolderFn = opts.openFolder ?? openInExplorer;
    this.server.on("client-connected", (socket) => this.server.sendTo(socket, "audio", this.stateMessage()));
    this.server.onChannel("audio", (payload, socket) => {
      const parsed = AudioMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      const msg = parsed.data;
      switch (msg.kind) {
        case "get-state":
          this.server.sendTo(socket, "audio", this.stateMessage());
          break;
        case "upload": {
          const r = this.upload(msg.name, msg.data);
          if (!r.ok) this.server.sendTo(socket, "audio", { kind: "error", message: r.error });
          break;
        }
        case "delete": {
          const r = this.remove(msg.name);
          if (!r.ok) this.server.sendTo(socket, "audio", { kind: "error", message: r.error });
          break;
        }
        case "open-folder":
          this.ensureDir();
          this.openFolderFn(this.dir);
          break;
        case "play": {
          // Botón "Probar" de la UI: pasa por el mismo camino que una Acción.
          const r = this.applyPlay(msg);
          if (!r.ok) this.server.sendTo(socket, "audio", { kind: "error", message: r.error });
          break;
        }
        default:
          break;
      }
    });
  }

  private ensureDir() {
    mkdirSync(this.dir, { recursive: true });
  }

  /** Archivos de audio de la carpeta (también los que el streamer copió a mano), por nombre. */
  list(): AudioFile[] {
    if (!existsSync(this.dir)) return [];
    const out: AudioFile[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!hasAudioExtension(name)) continue;
      try {
        const st = statSync(join(this.dir, name));
        if (st.isFile()) out.push({ name, sizeBytes: st.size });
      } catch {
        // desapareció entre el listado y el stat
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }

  /** Ruta absoluta de un archivo de la carpeta, o null si el nombre no es un archivo de audio directo de ella. */
  resolveFile(name: string): string | null {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") return null;
    if (!hasAudioExtension(name)) return null;
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
    const name = sanitizeAudioName(rawName);
    if (!name) return { ok: false, error: `"${rawName}": solo se admiten archivos ${AUDIO_EXTENSIONS.join(", ")}.` };
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length === 0) return { ok: false, error: `"${rawName}" está vacío.` };
    if (buf.length > AUDIO_MAX_BYTES) {
      return { ok: false, error: `"${rawName}" pesa más de ${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)} MB.` };
    }
    if (!looksLikeAudio(buf, name)) return { ok: false, error: `"${rawName}" no parece un archivo de audio válido.` };
    try {
      this.ensureDir();
      const finalName = this.uniqueName(name);
      writeFileSync(join(this.dir, finalName), buf);
      this.emit("log", { level: "info", message: `Audio guardado: ${finalName} (${Math.round(buf.length / 1024)} KB)` });
      this.broadcastState();
      return { ok: true, name: finalName };
    } catch (err) {
      return { ok: false, error: `No se pudo guardar "${rawName}": ${(err as Error).message}` };
    }
  }

  remove(name: string): { ok: true } | { ok: false; error: string } {
    const full = this.resolveFile(name);
    if (!full) return { ok: false, error: `"${name}" no está en la carpeta de audios.` };
    try {
      unlinkSync(full);
      this.emit("log", { level: "info", message: `Audio borrado: ${name}` });
      this.broadcastState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `No se pudo borrar "${name}": ${(err as Error).message}` };
    }
  }

  /** Comando interno `app.audio.play` (lo llama el motor de Acciones y el botón "Probar"). */
  applyPlay(params: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
    const parsed = AudioPlayParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: "Play Audio: parámetros inválidos (falta el archivo o el volumen no es 0–100)." };
    if (!this.resolveFile(parsed.data.file)) {
      return { ok: false, error: `Play Audio: el archivo "${parsed.data.file}" ya no está en la carpeta de audios.` };
    }
    this.server.broadcast("audio", { kind: "play", ...parsed.data });
    return { ok: true };
  }

  private stateMessage() {
    return { kind: "state" as const, files: this.list(), dir: this.dir, port: this.opts.httpPort() };
  }

  private broadcastState() {
    this.server.broadcast("audio", this.stateMessage());
  }
}
