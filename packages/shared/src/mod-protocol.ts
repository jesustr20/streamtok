import { z } from "zod";

/**
 * Protocolo WS entre la app StreamTok (SERVIDOR, ws://localhost:7331) y los
 * mods de juego (CLIENTES, se reconectan solos con backoff 1-10s).
 *
 * Fuente de verdad: proyecto "App TiktokCoinsGift - Proyecto Interactivo",
 * doc `claude/mod-gtav-integracion-app.md` (contrato v0.9.0 del mod de GTA V).
 *
 * Principio: el mod NO conoce TikTok. Publica su catálogo (`mod-hello`) y
 * ejecuta comandos ya resueltos (`mod-command`). La app decide el mapeo
 * evento→acción y le pone al viewer como `nameTag`.
 */

export const ModCategory = z.enum([
  "npc",
  "vehicle",
  "player",
  "weapon",
  "world",
  "spectacle",
  "character",
  "chiliad",
  "arena",
  "parkour",
  "other",
]);
export type ModCategoryT = z.infer<typeof ModCategory>;

export const ModParamType = z.enum(["int", "enum", "bool"]);

export const ModActionParamSchema = z.object({
  name: z.string(),
  type: ModParamType,
  default: z.union([z.number(), z.string(), z.boolean()]),
  min: z.number().optional(), // solo int
  max: z.number().optional(), // solo int
  options: z.array(z.string()).optional(), // solo enum
  presets: z.array(z.number()).optional(), // solo int: valores sugeridos para botones
});
export type ModActionParam = z.infer<typeof ModActionParamSchema>;

export const ModActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: ModCategory,
  icon: z.string(), // clave que la app mapea a su propia imagen
  description: z.string(),
  image: z.string().optional(), // solo en personajes custom (ruta/URL del JSON del streamer)
  supportsNameTag: z.boolean(),
  params: z.array(ModActionParamSchema),
});
export type ModAction = z.infer<typeof ModActionSchema>;

/** mod → app, al conectar */
export const ModHelloPayloadSchema = z.object({
  mod: z.string(), // ej. "gtav-chaos"
  version: z.string(), // ej. "0.9.0"
  actions: z.array(ModActionSchema),
});
export type ModHelloPayload = z.infer<typeof ModHelloPayloadSchema>;

/** app → mod */
export const ModCommandPayloadSchema = z.object({
  id: z.string(), // uuid generado por la app, se correlaciona con mod-ack
  action: z.string(), // ModAction.id
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  nameTag: z.string().optional(), // nombre del viewer (display name, no @username)
  notify: z.string().optional(), // texto opcional de notificación en pantalla
});
export type ModCommandPayload = z.infer<typeof ModCommandPayloadSchema>;

/** mod → app */
export const ModAckPayloadSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type ModAckPayload = z.infer<typeof ModAckPayloadSchema>;

export const ModHelloMessageSchema = z.object({
  channel: z.literal("mod-hello"),
  payload: ModHelloPayloadSchema,
});
export const ModCommandMessageSchema = z.object({
  channel: z.literal("mod-command"),
  payload: ModCommandPayloadSchema,
});
export const ModAckMessageSchema = z.object({
  channel: z.literal("mod-ack"),
  payload: ModAckPayloadSchema,
});

export const ModMessageSchema = z.discriminatedUnion("channel", [
  ModHelloMessageSchema,
  ModCommandMessageSchema,
  ModAckMessageSchema,
]);
export type ModMessage = z.infer<typeof ModMessageSchema>;

/** Límites operativos del mod, documentados en el contrato — la app debe
 * respetarlos para no acumular comandos que el mod va a descartar. */
export const MOD_LIMITS = {
  /** el mod procesa 3 comandos por frame */
  commandsPerFrame: 3,
  /** si hay más de 300 en cola, descarta los más viejos */
  maxQueueLength: 300,
  /** backoff de reconexión del cliente (mod), informativo para logs/UI */
  reconnectBackoffMs: { min: 1000, max: 10000 },
} as const;

/** Categorías de "modo" del mod de GTA V (prefijo del id de acción) — útiles
 * para agrupar en la UI de mapeo de eventos y para reglas especiales
 * (ej. arena_* necesita nameTag + coins siempre). */
export const MOD_MODE_PREFIXES = ["chiliad_", "arena_", "parkour_"] as const;

export function isArenaAction(actionId: string): boolean {
  return actionId.startsWith("arena_");
}
