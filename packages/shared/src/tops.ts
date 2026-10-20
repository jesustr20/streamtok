import { z } from "zod";
import { OverlayStyleSchema } from "./overlays.js";

/**
 * Tops (ADR 0017): rankings de espectadores que se dibujan como overlay (`/overlay/top/<id>`).
 * Concepto UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni del LiveEvent: el sidecar suma
 * los eventos que ya existen (regalos, likes, comentarios, compartidos) por persona.
 *
 * Cada ranking cuenta UNA cosa (`metric`) durante la sesión del LIVE o durante el día (`period`).
 */

export const TopMetricSchema = z.enum(["coins", "likes", "comments", "shares"]);
export type TopMetric = z.infer<typeof TopMetricSchema>;

export const TOP_METRIC_NAMES: Record<TopMetric, string> = {
  coins: "Monedas regaladas",
  likes: "Likes",
  comments: "Comentarios",
  shares: "Compartidos",
};

/** Unidad corta para el texto (p. ej. "1 200 monedas"). */
export const TOP_METRIC_UNITS: Record<TopMetric, string> = {
  coins: "monedas",
  likes: "likes",
  comments: "comentarios",
  shares: "compartidos",
};

/** `session`: empieza de cero al conectarte a otro LIVE. `day`: empieza de cero cada día (hora de tu equipo). */
export const TopPeriodSchema = z.enum(["session", "day"]);
export type TopPeriod = z.infer<typeof TopPeriodSchema>;

export const TOP_PERIOD_NAMES: Record<TopPeriod, string> = {
  session: "De esta sesión (LIVE)",
  day: "Del día",
};

export const TopIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: minúsculas, números y guiones");

export const TOP_MAX_COUNT = 10;

export const TopConfigSchema = z.object({
  id: TopIdSchema,
  title: z.string().max(60).default(""),
  metric: TopMetricSchema.default("coins"),
  period: TopPeriodSchema.default("session"),
  /** cuántos puestos se muestran (el diseño Podio siempre enseña 3) */
  count: z.number().int().min(1).max(TOP_MAX_COUNT).default(5),
  style: OverlayStyleSchema.default({ designId: "lista" }),
});
export type TopConfig = z.infer<typeof TopConfigSchema>;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export const TopEntrySchema = z.object({
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  score: z.number(),
});
export type TopEntry = z.infer<typeof TopEntrySchema>;

export const TopStateSchema = z.object({
  id: TopIdSchema,
  /** los mejores, de mayor a menor, hasta `count` */
  entries: z.array(TopEntrySchema),
  updatedAt: z.number(),
});
export type TopState = z.infer<typeof TopStateSchema>;

// ---------------------------------------------------------------------------
// Archivo `tops.json`
// ---------------------------------------------------------------------------

export const TopPersonSchema = z.object({
  handle: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  score: z.number(),
});
export type TopPerson = z.infer<typeof TopPersonSchema>;

export const TopRuntimeSchema = z.object({
  people: z.array(TopPersonSchema).default([]),
  /** día (YYYY-MM-DD) al que pertenecen los puntos; solo lo usa `period: "day"` */
  day: z.string().default(""),
  updatedAt: z.number().default(0),
});
export type TopRuntime = z.infer<typeof TopRuntimeSchema>;

export const TopsFileSchema = z.object({
  configs: z.array(TopConfigSchema).default([]),
  /** ids de los rankings de fábrica ya creados (uno que borres no reaparece) */
  seededIds: z.array(z.string()).default([]),
  runtime: z.record(TopRuntimeSchema).default({}),
});
export type TopsFile = z.infer<typeof TopsFileSchema>;

/**
 * Mensajes del canal WS `tops`.
 *  - `get-state`  cualquiera → sidecar
 *  - `state`      sidecar → todos: configuración y ranking de cada top
 *  - `save`       UI → sidecar: cambia la configuración de un top
 *  - `reset`      UI → sidecar: ranking a cero
 *  - `test`       UI → sidecar: suma `amount` a una persona de prueba, solo en este top
 *  - `error`      sidecar → UI
 */
export const TopsMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    configs: z.array(TopConfigSchema),
    states: z.array(TopStateSchema),
    serverNow: z.number(),
  }),
  z.object({ kind: z.literal("save"), config: TopConfigSchema }),
  z.object({ kind: z.literal("reset"), id: TopIdSchema }),
  z.object({
    kind: z.literal("test"),
    id: TopIdSchema,
    name: z.string().min(1).max(30),
    amount: z.number().int().min(1).max(1_000_000),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type TopsMessage = z.infer<typeof TopsMessageSchema>;

/** Rankings que vienen de fábrica (Interactive, TikFinity y TikControl: Top Gifters, Likes, Comentarios, Share y su versión Daily). */
export const TOP_PRESETS: TopConfig[] = [
  TopConfigSchema.parse({ id: "gifters", title: "Top Gifters", metric: "coins", period: "session", count: 5, style: { designId: "lista" } }),
  TopConfigSchema.parse({ id: "gifters-dia", title: "Top Gifters del día", metric: "coins", period: "day", count: 3, style: { designId: "podio" } }),
  TopConfigSchema.parse({ id: "likes", title: "Top Likes", metric: "likes", period: "session", count: 5, style: { designId: "lista" } }),
  TopConfigSchema.parse({ id: "comentarios", title: "Top Comentarios", metric: "comments", period: "session", count: 5, style: { designId: "lista" } }),
  TopConfigSchema.parse({ id: "compartidos", title: "Top Compartidos", metric: "shares", period: "session", count: 5, style: { designId: "lista" } }),
];

/** Día local como YYYY-MM-DD (para los rankings "del día"). */
export function dayKey(date: Date): string {
  const two = (n: number) => (n < 10 ? "0" + n : String(n));
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
