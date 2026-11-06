import { z } from "zod";

/**
 * Módulo de audio (ADR 0019): la acción general "Play Audio". Concepto propio
 * UI↔sidecar, NO está en mod-protocol.ts ni en live-event.ts.
 *
 * Un Evento dispara una Acción; si esta lleva el comando interno `app.audio.play`,
 * el sidecar avisa por el canal WS `audio` y la app de escritorio reproduce el
 * archivo (el audio sale por el equipo del streamer, que TikTok LIVE Studio
 * captura como audio del PC).
 */

/** Id del comando interno de la Acción (prefijo `app.`, ver `isAppCommand`). */
export const AUDIO_COMMAND_ID = "app.audio.play";

/** Extensiones admitidas y tamaño máximo por archivo (son efectos cortos). */
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg"] as const;
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/** Parámetros del comando `app.audio.play` y del aviso `play`. */
export const AudioPlayParamsSchema = z.object({
  /** Nombre del archivo dentro de la carpeta de audios. */
  file: z.string().min(1),
  /** 0–100. */
  volume: z.number().int().min(0).max(100).default(50),
  /** Si ese mismo audio ya está sonando (o esperando), el disparo nuevo se ignora. */
  oneShot: z.boolean().default(false),
  /** Corta todos los audios que suenen (y vacía la cola) antes de reproducir este. */
  skip: z.boolean().default(false),
  /** Espera a que terminen los audios que suenan en vez de sonar a la vez. */
  queue: z.boolean().default(false),
});
export type AudioPlayParams = z.infer<typeof AudioPlayParamsSchema>;

export const AudioFileSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type AudioFile = z.infer<typeof AudioFileSchema>;

/**
 * Canal WS `audio` (UI ↔ sidecar):
 *  - `get-state`    UI → sidecar: pedir la lista de archivos.
 *  - `state`        sidecar → UI: la lista vigente (a todos al cambiar).
 *  - `upload`       UI → sidecar: guardar un archivo (contenido en base64).
 *  - `delete`       UI → sidecar: borrar un archivo.
 *  - `open-folder`  UI → sidecar: abrir la carpeta de audios en el explorador.
 *  - `play`         sidecar → UI: reproducir (lo dispara una Acción, o el botón "Probar").
 *  - `error`        sidecar → UI: algo salió mal (archivo inválido, muy grande…).
 */
export const AudioMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), files: z.array(AudioFileSchema), dir: z.string(), port: z.number().int() }),
  z.object({ kind: z.literal("upload"), name: z.string(), data: z.string() }),
  z.object({ kind: z.literal("delete"), name: z.string() }),
  z.object({ kind: z.literal("open-folder") }),
  z.object({ kind: z.literal("play") }).merge(AudioPlayParamsSchema),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AudioMessage = z.infer<typeof AudioMessageSchema>;

/** Nombre de archivo seguro: sin rutas, sin caracteres raros y con extensión admitida; null si no sirve. */
export function sanitizeAudioName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = cleaned.slice(dot).toLowerCase();
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return null;
  const stem = cleaned.slice(0, dot).trim().slice(0, 100);
  if (!stem) return null;
  return stem + ext;
}

/** Qué hacer con un disparo de audio según lo que suena y lo que espera (One-Shot, Saltar, Cola). */
export type AudioDecision = { action: "ignore" } | { action: "play"; stopAll: boolean } | { action: "queue" };

export function decideAudioPlay(
  playing: readonly string[],
  queued: readonly string[],
  req: Pick<AudioPlayParams, "file" | "oneShot" | "skip" | "queue">,
): AudioDecision {
  // "Saltar" manda: corta todo y suena este, aunque sea One-Shot.
  if (req.skip) return { action: "play", stopAll: true };
  if (req.oneShot && (playing.includes(req.file) || queued.includes(req.file))) return { action: "ignore" };
  if (req.queue && playing.length > 0) return { action: "queue" };
  return { action: "play", stopAll: false };
}

/** Lo mínimo que el planificador necesita de un reproductor (un `HTMLAudioElement` lo cumple). */
export interface AudioLike {
  volume: number;
  play(): Promise<void>;
  pause(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onended: ((ev: any) => any) | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onerror: ((ev: any) => any) | null;
}

/**
 * Planificador de la reproducción (One-Shot, Saltar, Cola). Lo usa la app de
 * escritorio con `HTMLAudioElement`; vive aquí para poder probarlo sin navegador.
 */
export class AudioScheduler {
  private playing = new Map<AudioLike, string>();
  private queue: AudioPlayParams[] = [];

  constructor(
    private create: (file: string) => AudioLike,
    private onError?: (message: string, err?: unknown) => void,
  ) {}

  /** Archivos que suenan ahora mismo (para pruebas). */
  get active(): string[] {
    return [...this.playing.values()];
  }

  get waiting(): string[] {
    return this.queue.map((q) => q.file);
  }

  play(req: AudioPlayParams): void {
    const decision = decideAudioPlay(this.active, this.waiting, req);
    if (decision.action === "ignore") return;
    if (decision.action === "queue") {
      this.queue.push(req);
      return;
    }
    if (decision.stopAll) this.stopAll();
    this.start(req);
  }

  /** Corta todo lo que suena y vacía la cola. */
  stopAll(): void {
    this.queue = [];
    for (const [audio] of [...this.playing]) {
      this.playing.delete(audio);
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // ya estaba detenido
      }
    }
  }

  private start(req: AudioPlayParams): void {
    const audio = this.create(req.file);
    audio.volume = Math.min(1, Math.max(0, req.volume / 100));
    this.playing.set(audio, req.file);
    const finished = () => {
      if (!this.playing.delete(audio)) return; // ya lo cortó stopAll
      this.drain();
    };
    audio.onended = finished;
    audio.onerror = () => {
      this.onError?.(`No se pudo reproducir "${req.file}".`);
      finished();
    };
    audio.play().catch((err) => {
      this.onError?.(`No se pudo reproducir "${req.file}".`, err);
      finished();
    });
  }

  /** Cuando no suena nada, arranca el siguiente de la cola. */
  private drain(): void {
    if (this.playing.size > 0) return;
    const next = this.queue.shift();
    if (next) this.start(next);
  }
}
