import { z } from "zod";
import { OVERLAY_DESIGNS, OverlayStyleSchema } from "./overlays.js";

/**
 * Metas (ADR 0012). Una meta cuenta una métrica del LIVE hacia un objetivo y se
 * dibuja como overlay (`/overlay/meta/<id>`). Puede haber varias a la vez.
 * Concepto UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni del LiveEvent.
 */

export const GoalMetricSchema = z.enum(["coins", "gifts", "likes", "follows", "shares", "subscribes", "comments"]);
export type GoalMetric = z.infer<typeof GoalMetricSchema>;

export const GOAL_METRICS: Array<{ id: GoalMetric; name: string; unit: string }> = [
  { id: "coins", name: "Monedas", unit: "monedas" },
  { id: "gifts", name: "Regalos", unit: "regalos" },
  { id: "likes", name: "Likes", unit: "likes" },
  { id: "follows", name: "Seguidores nuevos", unit: "seguidores" },
  { id: "shares", name: "Compartidos", unit: "compartidos" },
  { id: "subscribes", name: "Suscripciones", unit: "suscripciones" },
  { id: "comments", name: "Comentarios", unit: "comentarios" },
];

/** Qué pasa al llegar al objetivo: `stay` se queda lleno, `grow` suma `step` al objetivo, `reset` vuelve a 0. */
export const GoalOnReachSchema = z.enum(["stay", "grow", "reset"]);
export type GoalOnReach = z.infer<typeof GoalOnReachSchema>;

export const GoalIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: minúsculas, números y guiones");

export const GoalConfigSchema = z.object({
  id: GoalIdSchema,
  /** título que muestra el diseño, p. ej. "Meta de likes" */
  title: z.string().max(60).default(""),
  metric: GoalMetricSchema.default("coins"),
  /** solo para `coins` y `gifts`: cuenta únicamente este regalo (id de TikTok) */
  giftId: z.number().int().positive().optional(),
  /** objetivo a alcanzar */
  target: z.number().int().positive().default(1000),
  onReach: GoalOnReachSchema.default("stay"),
  /** cuánto sube el objetivo en cada cruce cuando `onReach` es `grow` */
  step: z.number().int().positive().default(1000),
  /** cuenta atrás: el overlay muestra cuánto FALTA ("Quedan N") en vez del porcentaje */
  countdown: z.boolean().default(false),
  /** texto antes y después del número que falta (diseño Texto y cuenta atrás); vacíos = "Faltan N" */
  textBefore: z.string().max(60).default(""),
  textAfter: z.string().max(60).default(""),
  /** entra en el overlay "Metas rotativas" (`/overlay/meta/rotativa`) */
  rotate: z.boolean().default(false),
  /** ids de Acciones que se ejecutan cada vez que se cumple la meta */
  onReachAccionIds: z.array(z.string()).default([]),
  style: OverlayStyleSchema.default({ designId: "interactive" }),
});
export type GoalConfig = z.infer<typeof GoalConfigSchema>;

export const GoalStateSchema = z.object({
  id: GoalIdSchema,
  /** avance actual */
  current: z.number().int(),
  /** objetivo vigente (puede haber subido respecto a `config.target` con `grow`) */
  target: z.number().int().positive(),
  /** cuántas veces se ha cumplido */
  reached: z.number().int().nonnegative(),
});
export type GoalState = z.infer<typeof GoalStateSchema>;

/** Meta completa tal como la ve la UI y el overlay. */
export const GoalSchema = z.object({ config: GoalConfigSchema, state: GoalStateSchema });
export type Goal = z.infer<typeof GoalSchema>;

/** Forma en disco de `goals.json`. */
export const GoalsFileSchema = z.object({
  goals: z.array(GoalSchema).default([]),
  /** las metas por defecto ya se crearon una vez (así borrar una no la hace reaparecer) */
  seeded: z.boolean().default(false),
});
export type GoalsFile = z.infer<typeof GoalsFileSchema>;

export const GoalOpSchema = z.enum(["add", "set", "reset"]);
export type GoalOp = z.infer<typeof GoalOpSchema>;

/**
 * Canal WS `goals`:
 *  - `get-state`     cliente → sidecar.
 *  - `state`         sidecar → todos: todas las metas (+ `serverNow`).
 *  - `save`          UI → sidecar: crea o actualiza la configuración de una meta.
 *  - `remove`        UI → sidecar: borra una meta.
 *  - `goal-control`  UI → sidecar: sumar, fijar o reiniciar el avance.
 *  - `error`         sidecar → quien pidió.
 */
export const GoalsMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), goals: z.array(GoalSchema), serverNow: z.number() }),
  z.object({ kind: z.literal("save"), config: GoalConfigSchema }),
  z.object({ kind: z.literal("remove"), id: GoalIdSchema }),
  z.object({ kind: z.literal("goal-control"), id: GoalIdSchema, op: GoalOpSchema, value: z.number().optional() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type GoalsMessage = z.infer<typeof GoalsMessageSchema>;

/** Porcentaje 0–100 del avance (nunca negativo ni mayor a 100). */
export function goalPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

/**
 * Texto de lo que falta ("Faltan 380", o con los textos del usuario: "Hay 380 likes por conseguir") y
 * "¡Meta cumplida!" al llegar. Copia JS en overlay-pages.ts (un test las compara).
 */
export function goalRemainingText(current: number, target: number, before = "", after = ""): string {
  const left = target - current;
  if (left <= 0) return "¡Meta cumplida!";
  return before || after ? before + String(left) + after : "Faltan " + String(left);
}

export const GOAL_DESIGNS = OVERLAY_DESIGNS.meta;

/** Id reservado: el overlay que va mostrando, una a una, las metas con `rotate`. */
export const GOAL_ROTATION_ID = "rotativa";

/**
 * Metas que vienen ya creadas (ids fijos). Se crean la primera vez que arranca el
 * sidecar; después son editables y se pueden borrar. No hay "espectadores": TikTok
 * no manda ese dato al sidecar (ver ADR 0012).
 */
export const GOAL_PRESETS: GoalConfig[] = [
  { id: "likes", title: "Meta Likes", metric: "likes", target: 5000, accent: "#e23a57" },
  { id: "seguidores", title: "Meta Seguidores", metric: "follows", target: 100, accent: "#2a9d8f" },
  { id: "compartidos", title: "Meta Compartidos", metric: "shares", target: 200, accent: "#4f86c6" },
  { id: "monedas", title: "Monedas", metric: "coins", target: 500, accent: "#c28a1d" },
  { id: "superfans", title: "Super Fans", metric: "subscribes", target: 10, accent: "#7b61d9" },
  { id: "regalos", title: "Meta Regalos", metric: "gifts", target: 50, accent: "#d9577f" },
].map((p) =>
  GoalConfigSchema.parse({
    id: p.id,
    title: p.title,
    metric: p.metric,
    target: p.target,
    onReach: "grow",
    step: p.target,
    rotate: p.id !== "regalos",
    style: { designId: "interactive", accentColor: p.accent },
  }),
);
