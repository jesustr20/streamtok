import { z } from "zod";
import { OverlayStyleSchema } from "./overlays.js";

/**
 * Duelos (ADR 0015): dos lados que compiten en pantalla. Se dibujan como overlay
 * (`/overlay/duelo/<id>`). Concepto UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni
 * del LiveEvent: el sidecar suma los eventos que ya existen (regalos, likes, comentarios).
 *
 * Tres modos:
 *  - `regalos`  Gift vs Gift / Regalos vs Regalos: cada lado cuenta los regalos que le pongas.
 *  - `equipos`  Azul vs Rojo: la gente elige equipo con un comando del chat y suma para él.
 *  - `top`      Top 1 vs Top 2: los dos mayores donadores de la sesión, frente a frente.
 */

export const DuelModeSchema = z.enum(["regalos", "equipos", "top"]);
export type DuelMode = z.infer<typeof DuelModeSchema>;

export const DuelMetricSchema = z.enum(["coins", "gifts", "likes", "comments"]);
export type DuelMetric = z.infer<typeof DuelMetricSchema>;

export const DUEL_MODES: Array<{ id: DuelMode; name: string; metrics: DuelMetric[] }> = [
  { id: "regalos", name: "Regalo vs Regalo", metrics: ["coins", "gifts"] },
  { id: "equipos", name: "Equipos", metrics: ["coins", "gifts", "likes", "comments"] },
  { id: "top", name: "Top 1 vs Top 2", metrics: ["coins"] },
];

export const DUEL_METRIC_NAMES: Record<DuelMetric, string> = {
  coins: "Monedas",
  gifts: "Cantidad de regalos",
  likes: "Likes",
  comments: "Comentarios",
};

export const DuelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: minúsculas, números y guiones");

export const DuelSideConfigSchema = z.object({
  /** nombre del lado (en `top` se usa el del donador) */
  name: z.string().max(30).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color: #rrggbb").default("#ff3d71"),
  /** modo `regalos`: nombres de regalo (sin importar mayúsculas) o ids numéricos que suman a este lado */
  gifts: z.array(z.string().min(1).max(60)).max(20).default([]),
  /** modo `regalos`: imagen del regalo que representa a este lado (la pone la app al elegirlo del catálogo) */
  icon: z.string().max(2000).optional(),
  /** modo `regalos`: valor en monedas del regalo que representa a este lado (lo pone la app); solo lo usa el ejemplo de la vista previa */
  cost: z.number().int().nonnegative().optional(),
  /** modo `equipos`: comandos de chat para unirse a este lado (p. ej. "!azul") */
  commands: z.array(z.string().min(1).max(30)).max(10).default([]),
});
export type DuelSideConfig = z.infer<typeof DuelSideConfigSchema>;

export const DuelConfigSchema = z.object({
  id: DuelIdSchema,
  title: z.string().max(60).default(""),
  mode: DuelModeSchema,
  metric: DuelMetricSchema.default("coins"),
  sides: z.tuple([DuelSideConfigSchema, DuelSideConfigSchema]),
  style: OverlayStyleSchema.default({ designId: "barra" }),
});
export type DuelConfig = z.infer<typeof DuelConfigSchema>;

// ---------------------------------------------------------------------------
// Estado de un duelo
// ---------------------------------------------------------------------------

export const DuelSupporterSchema = z.object({
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  score: z.number(),
});
export type DuelSupporter = z.infer<typeof DuelSupporterSchema>;

export const DuelSideStateSchema = z.object({
  score: z.number(),
  /** quienes más aportaron a este lado (máx. 3); en `top` va vacío */
  supporters: z.array(DuelSupporterSchema).default([]),
  /** modo `equipos`: cuántas personas se unieron */
  members: z.number().int().nonnegative().optional(),
  /** modo `top`: el donador que ocupa este puesto */
  name: z.string().optional(),
  avatarUrl: z.string().min(1).optional(),
});
export type DuelSideState = z.infer<typeof DuelSideStateSchema>;

export const DuelStateSchema = z.object({
  id: DuelIdSchema,
  sides: z.tuple([DuelSideStateSchema, DuelSideStateSchema]),
  updatedAt: z.number(),
});
export type DuelState = z.infer<typeof DuelStateSchema>;

// ---------------------------------------------------------------------------
// Archivo `duelos.json`
// ---------------------------------------------------------------------------

const PersistedPersonSchema = z.object({
  handle: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  score: z.number(),
});
export type PersistedPerson = z.infer<typeof PersistedPersonSchema>;

export const DuelRuntimeSchema = z.object({
  sides: z.tuple([
    z.object({ score: z.number().default(0), supporters: z.array(PersistedPersonSchema).default([]) }),
    z.object({ score: z.number().default(0), supporters: z.array(PersistedPersonSchema).default([]) }),
  ]),
  /** modo `equipos`: handle → lado (0 o 1) */
  members: z.record(z.union([z.literal(0), z.literal(1)])).default({}),
  /** modo `top`: ranking de donadores de la sesión */
  donors: z.array(PersistedPersonSchema).default([]),
  updatedAt: z.number().default(0),
});
export type DuelRuntime = z.infer<typeof DuelRuntimeSchema>;

export const DuelosFileSchema = z.object({
  configs: z.array(DuelConfigSchema).default([]),
  /** ids de los duelos de fábrica ya creados (uno que borres no reaparece) */
  seededIds: z.array(z.string()).default([]),
  runtime: z.record(DuelRuntimeSchema).default({}),
});
export type DuelosFile = z.infer<typeof DuelosFileSchema>;

/**
 * Mensajes del canal WS `duelos`.
 *  - `get-state`  cualquiera → sidecar
 *  - `state`      sidecar → todos: configuración y marcador de cada duelo
 *  - `save`       UI → sidecar: crea o cambia la configuración de un duelo
 *  - `reset`      UI → sidecar: marcador a cero (y equipos vacíos)
 *  - `adjust`     UI → sidecar: suma o resta puntos a un lado (corregir a mano)
 *  - `test`       UI → sidecar: regalos de prueba (`units`) de una persona de prueba, solo en este duelo
 *  - `error`      sidecar → UI
 */
export const DuelosMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    configs: z.array(DuelConfigSchema),
    states: z.array(DuelStateSchema),
    serverNow: z.number(),
  }),
  z.object({ kind: z.literal("save"), config: DuelConfigSchema }),
  z.object({ kind: z.literal("reset"), id: DuelIdSchema }),
  z.object({ kind: z.literal("adjust"), id: DuelIdSchema, side: z.union([z.literal(0), z.literal(1)]), delta: z.number().int() }),
  // regalo de prueba (solo cuenta en este duelo, no pasa por Acciones ni por las demás metas)
  z.object({
    kind: z.literal("test"),
    id: DuelIdSchema,
    side: z.union([z.literal(0), z.literal(1)]),
    units: z.number().int().min(1).max(50),
    name: z.string().min(1).max(30),
    /** valor en monedas de cada regalo de prueba (equipos y top; en `regalos` se usa el del regalo del lado) */
    coins: z.number().int().min(1).max(1_000_000).optional(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type DuelosMessage = z.infer<typeof DuelosMessageSchema>;

/** Duelos que vienen de fábrica (Interactive: Gift vs Gift, GVSG Bar/Battle; BLUE vs RED; Top 1 vs Top 2). */
export const DUEL_PRESETS: DuelConfig[] = [
  DuelConfigSchema.parse({
    id: "regalo-vs-regalo",
    title: "Regalo vs Regalo",
    mode: "regalos",
    metric: "coins",
    sides: [
      { name: "Rose", color: "#ff3d71", gifts: ["Rose"] },
      { name: "Finger Heart", color: "#3da5ff", gifts: ["Finger Heart"] },
    ],
    style: { designId: "barra" },
  }),
  DuelConfigSchema.parse({
    id: "equipos",
    title: "Azul vs Rojo",
    mode: "equipos",
    metric: "coins",
    sides: [
      { name: "AZUL", color: "#2f7bff", commands: ["!azul", "!blue"] },
      { name: "ROJO", color: "#ff3b3b", commands: ["!rojo", "!red"] },
    ],
    style: { designId: "marcador" },
  }),
  DuelConfigSchema.parse({
    id: "top",
    title: "Top 1 vs Top 2",
    mode: "top",
    metric: "coins",
    sides: [{ color: "#ffc233" }, { color: "#b4bcc8" }],
    style: { designId: "versus" },
  }),
];

// ---------------------------------------------------------------------------
// Coincidencias
// ---------------------------------------------------------------------------

/** ¿Este regalo es uno de los de la lista? Cada elemento es un nombre (sin importar mayúsculas) o un id numérico. */
export function giftMatches(tokens: string[], giftName?: string, giftId?: number): boolean {
  const name = giftName?.trim().toLowerCase();
  for (const raw of tokens) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (name !== undefined && t === name) return true;
    if (giftId !== undefined && /^\d+$/.test(t) && Number(t) === giftId) return true;
  }
  return false;
}

/** ¿El comentario empieza por uno de los comandos? Se compara la primera palabra, sin importar mayúsculas. */
export function commandMatches(commands: string[], text?: string): boolean {
  const first = text?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return false;
  return commands.some((c) => c.trim().toLowerCase() === first);
}
