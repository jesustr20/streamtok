import { z } from "zod";

/**
 * Módulo de medios (ADR 0022): la acción general "Mostrar IMG / GIF / VIDEO".
 * Concepto propio UI↔sidecar, NO está en mod-protocol.ts ni en live-event.ts.
 *
 * Un Evento dispara una Acción; si esta lleva el comando interno `app.media.show`,
 * el sidecar avisa por el canal WS `media` y la página de overlay `/overlay/pantalla/<n>`
 * (que el streamer pega como fuente web en TikTok LIVE Studio) dibuja la imagen, el GIF
 * o el video. Es la misma idea que las "pantallas" de Interactive.
 */

export const MEDIA_COMMAND_ID = "app.media.show";

export const MEDIA_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"] as const;
export const MEDIA_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"] as const;
export const MEDIA_EXTENSIONS = [...MEDIA_IMAGE_EXTENSIONS, ...MEDIA_VIDEO_EXTENSIONS] as const;
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
/** Cuántas pantallas (`/overlay/pantalla/1` … `/overlay/pantalla/N`) se pueden usar. */
export const MEDIA_MAX_SCREENS = 9;
/** Segundos que se muestra una imagen o GIF cuando la duración es 0 («automática»). */
export const MEDIA_IMAGE_DEFAULT_SECONDS = 5;

export type MediaKind = "image" | "video";

export function mediaKindOf(name: string): MediaKind | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  if ((MEDIA_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((MEDIA_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return null;
}

/** Direcciones web admitidas para «Archivos web»: http(s) y con un archivo de imagen/video al final. */
export function parseMediaUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  return u.protocol === "https:" || u.protocol === "http:" ? u : null;
}

export const MediaShowParamsSchema = z
  .object({
    /** `local`: un archivo de la carpeta de medios. `web`: una URL de internet. */
    source: z.enum(["local", "web"]).default("local"),
    /** Nombre del archivo dentro de la carpeta de medios (source = local). */
    file: z.string().default(""),
    /** URL de la imagen, GIF o video (source = web). */
    url: z.string().default(""),
    /** Pantalla del overlay donde se muestra (`/overlay/pantalla/<n>`). */
    screen: z.number().int().min(1).max(MEDIA_MAX_SCREENS).default(1),
    /** Tamaño máximo respecto de la pantalla del overlay (10–100 %). */
    sizePct: z.number().int().min(10).max(100).default(50),
    /** Segundos en pantalla; 0 = automática (imagen: 5 s; video: hasta que termine). */
    durationSec: z.number().min(0).max(600).default(0),
    /** 0–100 (solo videos). */
    volume: z.number().int().min(0).max(100).default(50),
  })
  .refine((p) => (p.source === "local" ? p.file !== "" : p.url !== ""), { message: "falta elegir el archivo o la URL" });
export type MediaShowParams = z.infer<typeof MediaShowParamsSchema>;

export const MediaFileSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  kind: z.enum(["image", "video"]),
});
export type MediaFile = z.infer<typeof MediaFileSchema>;

/** Un enlace guardado en «Archivos web». */
export const MediaWebItemSchema = z.object({ name: z.string(), url: z.string() });
export type MediaWebItem = z.infer<typeof MediaWebItemSchema>;

/** Lo que el overlay recibe en `show` (los parámetros ya resueltos). */
const ShowSchema = z.object({
  kind: z.literal("show"),
  source: z.enum(["local", "web"]),
  file: z.string(),
  url: z.string(),
  screen: z.number().int(),
  sizePct: z.number().int(),
  durationSec: z.number(),
  volume: z.number().int(),
});

/**
 * Canal WS `media` (UI/overlay ↔ sidecar):
 *  - `get-state`   → pedir la lista.      - `state`  ← archivos, enlaces, carpeta y puerto HTTP.
 *  - `upload`      → guardar un archivo (base64).   - `delete`  → borrar un archivo.
 *  - `add-web` / `delete-web` → guardar o quitar un enlace de «Archivos web».
 *  - `open-folder` → abrir la carpeta.
 *  - `show`        ← el sidecar manda mostrar (lo dispara una Acción o el botón «Probar»); las páginas de overlay lo escuchan.
 *  - `error`       ← algo salió mal.
 */
export const MediaMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    files: z.array(MediaFileSchema),
    web: z.array(MediaWebItemSchema),
    dir: z.string(),
    port: z.number().int(),
  }),
  z.object({ kind: z.literal("upload"), name: z.string(), data: z.string() }),
  z.object({ kind: z.literal("delete"), name: z.string() }),
  z.object({ kind: z.literal("add-web"), url: z.string(), name: z.string() }),
  z.object({ kind: z.literal("delete-web"), url: z.string() }),
  z.object({ kind: z.literal("open-folder") }),
  ShowSchema,
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type MediaMessage = z.infer<typeof MediaMessageSchema>;

/** Nombre de archivo seguro (sin rutas ni caracteres raros) con extensión admitida; null si no sirve. */
export function sanitizeMediaName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return null;
  if (!mediaKindOf(cleaned)) return null;
  const stem = cleaned.slice(0, dot).trim().slice(0, 100);
  return stem ? stem + cleaned.slice(dot).toLowerCase() : null;
}

/** Revisa los primeros bytes: que un .png sea de verdad un png, etc. (no un archivo cualquiera renombrado). */
export function looksLikeMedia(buf: Uint8Array, name: string): boolean {
  const b = buf;
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  switch (ext) {
    case ".png":
      return b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG";
    case ".jpg":
    case ".jpeg":
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case ".gif":
      return b.length >= 6 && ascii(0, 4) === "GIF8";
    case ".webp":
      return b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case ".avif":
    case ".mp4":
    case ".mov":
      return b.length >= 12 && ascii(4, 8) === "ftyp";
    case ".webm":
      return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    default:
      return false;
  }
}
