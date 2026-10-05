import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { EventCompactor } from "./event-compactor.js";

/**
 * Grabadora de eventos crudos del LIVE de TikTok.
 *
 * Guarda TODO lo que llega, sin filtrar ni normalizar (incluye mensajes que la
 * app todavía no usa: niveles, batallas, ranking, etc.), una línea JSON por
 * mensaje, en un archivo propio. Sirve para descubrir qué datos entrega TikTok
 * y decidir después qué se normaliza al contrato. Es independiente del
 * catálogo de regalos (gift-catalog.ts), que solo aprende regalos.
 *
 * Se crea una por cada conexión al LIVE (ver tiktok-connection.ts) y nunca
 * debe romper el pipeline en vivo: cualquier fallo se reporta por `onLog` y se sigue.
 *
 * Privacidad: los mensajes incluyen datos públicos de viewers (handles,
 * nicknames, ids, avatares). El archivo queda solo en la máquina del usuario,
 * fuera del repo.
 */

/** Tope por defecto de un archivo de grabación (los lives con batallas generan mucho). */
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

export interface EventRecorderOptions {
  /** Carpeta donde se crea el archivo de la sesión. */
  dir: string;
  /** Identifica el LIVE (ej. el username); entra en el nombre del archivo. */
  label?: string;
  /** Tope de bytes del archivo; al llegar se deja de grabar. */
  maxBytes?: number;
  /** Quita relleno y deduplica taps/joins repetidos (ver event-compactor.ts). Por defecto true. */
  compact?: boolean;
  onLog?: (message: string) => void;
  now?: () => number;
}

/** Convierte a algo serializable a JSON: bigint → string, bytes → "[bytes:N]", ciclos → "[Circular]". */
function sanitize(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;
  if (value instanceof Date) return value.toISOString();
  if (path.has(value)) return "[Circular]";

  // `path` solo contiene los ancestros del nodo actual: el mismo objeto en dos
  // ramas hermanas (no circular) se guarda completo en ambas.
  path.add(value);
  const out = Array.isArray(value)
    ? value.map((v) => sanitize(v, path))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, path)]));
  path.delete(value);
  return out;
}

function safeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class EventRecorder {
  /** Ruta del archivo de esta sesión (se crea al grabar el primer evento). */
  readonly filePath: string;

  private stream: WriteStream | null = null;
  private bytes = 0;
  private full = false;
  private readonly maxBytes: number;
  private readonly compactor: EventCompactor | null;
  private readonly now: () => number;

  constructor(private readonly opts: EventRecorderOptions) {
    this.now = opts.now ?? Date.now;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.compactor = opts.compact === false ? null : new EventCompactor();
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
    const label = opts.label ? `${safeLabel(opts.label)}-` : "";
    this.filePath = join(opts.dir, `live-${label}${stamp}.jsonl`);
  }

  /** Graba un mensaje decodificado de TikTok (`type` = nombre del mensaje, ej. "WebcastGiftMessage"). */
  record(type: string, event: unknown): void {
    if (this.full) return;
    try {
      const clean = sanitize(event, new WeakSet());
      const { ref, event: out } = this.compactor ? this.compactor.process(type, clean) : { ref: undefined, event: clean };
      const line = JSON.stringify({ t: this.now(), type, ref, event: out }) + "\n";
      const size = Buffer.byteLength(line);
      if (this.bytes + size > this.maxBytes) {
        this.full = true;
        this.opts.onLog?.(
          `Grabación detenida: se alcanzó el tope de ${(this.maxBytes / 1024 / 1024).toFixed(1)} MB (${this.filePath}).`,
        );
        return;
      }
      this.ensureStream().write(line);
      this.bytes += size;
    } catch (err) {
      this.opts.onLog?.(`No se pudo grabar un evento "${type}": ${(err as Error).message ?? err}`);
    }
  }

  /** Cierra el archivo esperando a que se vacíe el buffer de escritura. */
  close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return Promise.resolve();
    return new Promise((resolve) => stream.end(() => resolve()));
  }

  private ensureStream(): WriteStream {
    if (!this.stream) {
      mkdirSync(this.opts.dir, { recursive: true });
      this.stream = createWriteStream(this.filePath, { flags: "a" });
      this.stream.on("error", (err) => {
        this.full = true;
        this.opts.onLog?.(`Error escribiendo la grabación, se detiene: ${err.message}`);
      });
    }
    return this.stream;
  }
}

/**
 * Tope en bytes definido por `STREAMTOK_RECORD_MAX_MB` (MB, admite decimales);
 * `undefined` si no está definido o es inválido (se usa el tope por defecto).
 */
export function maxBytesFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const maxMb = Number(env.STREAMTOK_RECORD_MAX_MB);
  return Number.isFinite(maxMb) && maxMb > 0 ? Math.floor(maxMb * 1024 * 1024) : undefined;
}
