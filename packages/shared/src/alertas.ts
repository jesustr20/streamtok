import { z } from "zod";
import { OverlayStyleSchema } from "./overlays.js";

/**
 * Alertas de comunidad y nivel (ADR 0014). Un aviso en pantalla cuando alguien se une a la
 * comunidad (Fan Club) o sube de nivel. Se dibuja como overlay (`/overlay/nivel/<id>`).
 * Concepto UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni del LiveEvent: el
 * sidecar los deduce de eventos que ya existen (regalo de unirse, `fanLevelUp`, `donorLevelUp`).
 */

export const AlertKindSchema = z.enum(["fanJoin", "fanLevelUp", "donorLevelUp"]);
export type AlertKind = z.infer<typeof AlertKindSchema>;

export const ALERT_KINDS: Array<{ id: AlertKind; name: string; defaultText: string }> = [
  { id: "fanJoin", name: "Se une a la comunidad", defaultText: "{nombre} se unió a la comunidad" },
  { id: "fanLevelUp", name: "Sube de nivel de fan", defaultText: "{nombre} subió al nivel {nivel} de la comunidad" },
  { id: "donorLevelUp", name: "Sube de nivel de donador", defaultText: "{nombre} alcanzó el nivel de donador {nivel}" },
];

export const AlertIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: minúsculas, números y guiones");

export const AlertTextsSchema = z.object({
  fanJoin: z.string().max(120).default(ALERT_KINDS[0].defaultText),
  fanLevelUp: z.string().max(120).default(ALERT_KINDS[1].defaultText),
  donorLevelUp: z.string().max(120).default(ALERT_KINDS[2].defaultText),
});
export type AlertTexts = z.infer<typeof AlertTextsSchema>;

export const AlertConfigSchema = z.object({
  id: AlertIdSchema,
  title: z.string().max(60).default(""),
  /** qué avisos muestra este overlay */
  kinds: z.array(AlertKindSchema).default(["fanJoin", "fanLevelUp"]),
  /** segundos que se queda cada aviso en pantalla */
  durationSec: z.number().min(2).max(30).default(6),
  /** solo avisa de subidas de nivel iguales o mayores a este (1 = todas) */
  minLevel: z.number().int().min(1).max(100).default(1),
  /** frases; `{nombre}` y `{nivel}` se sustituyen */
  texts: AlertTextsSchema.default({}),
  style: OverlayStyleSchema.default({ designId: "interactive" }),
});
export type AlertConfig = z.infer<typeof AlertConfigSchema>;

/** Nombres (en minúsculas) de regalos con los que alguien se une a la comunidad: en TikTok es el regalo "Heart Me". */
export const DEFAULT_JOIN_GIFT_NAMES = ["heart me", "quiéreme", "quiereme"];

export const AlertasFileSchema = z.object({
  configs: z.array(AlertConfigSchema).default([]),
  /** ids de las alertas de fábrica ya creadas (una que borres no reaparece) */
  seededIds: z.array(z.string()).default([]),
  joinGiftNames: z.array(z.string().min(1).max(60)).max(20).default(DEFAULT_JOIN_GIFT_NAMES),
});
export type AlertasFile = z.infer<typeof AlertasFileSchema>;

/** Un aviso concreto que viaja del sidecar a los overlays. */
export const AlertEventSchema = z.object({
  kind: AlertKindSchema,
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  level: z.number().int().nonnegative().optional(),
  previousLevel: z.number().int().nonnegative().optional(),
  at: z.number(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

/**
 * Mensajes del canal WS `alertas`.
 *  - `get-state`      cualquiera → sidecar
 *  - `state`          sidecar → todos: configuración
 *  - `alert`          sidecar → overlays: un aviso para mostrar
 *  - `save`           UI → sidecar: crea o cambia la configuración de un overlay
 *  - `set-join-gifts` UI → sidecar: nombres de regalo que cuentan como "unirse"
 *  - `test`           UI → sidecar: lanza un aviso de prueba a todos los overlays
 *  - `error`          sidecar → UI
 */
export const AlertasMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    configs: z.array(AlertConfigSchema),
    joinGiftNames: z.array(z.string()),
    serverNow: z.number(),
  }),
  z.object({ kind: z.literal("alert"), alert: AlertEventSchema }),
  z.object({ kind: z.literal("save"), config: AlertConfigSchema }),
  z.object({ kind: z.literal("set-join-gifts"), names: z.array(z.string().min(1).max(60)).max(20) }),
  z.object({ kind: z.literal("test"), alertKind: AlertKindSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AlertasMessage = z.infer<typeof AlertasMessageSchema>;

/** Alertas que vienen de fábrica (Interactive: Nivel Fans, Nivel Donador, Nivel Rotativo). */
export const ALERT_PRESETS: AlertConfig[] = [
  AlertConfigSchema.parse({
    id: "comunidad",
    title: "Comunidad",
    kinds: ["fanJoin", "fanLevelUp"],
    style: { designId: "interactive" },
  }),
  AlertConfigSchema.parse({
    id: "donador",
    title: "Donadores",
    kinds: ["donorLevelUp"],
    style: { designId: "interactive" },
  }),
  AlertConfigSchema.parse({
    id: "todas",
    title: "Todas",
    kinds: ["fanJoin", "fanLevelUp", "donorLevelUp"],
    style: { designId: "interactive" },
  }),
];

/** Sustituye `{nombre}` y `{nivel}` en una frase. */
export function alertText(template: string, name: string, level?: number): string {
  return template.split("{nombre}").join(name).split("{nivel}").join(level === undefined ? "" : String(level));
}

/** ¿Es este regalo el que usa la gente para unirse a la comunidad? */
export function isJoinGift(giftName: string | undefined, names: string[]): boolean {
  if (!giftName) return false;
  const g = giftName.trim().toLowerCase();
  return names.some((n) => n.trim().toLowerCase() === g);
}
