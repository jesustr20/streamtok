import { z } from "zod";
import { OverlayStyleSchema } from "./overlays.js";

/**
 * Agente IA (ADR 0016), fase (a) pieza 1: la cola de preguntas con prioridad y el overlay. Concepto
 * UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni del LiveEvent: el sidecar lee los
 * eventos que ya existen (comentarios, regalos, seguir, compartir).
 *
 * Los espectadores preguntan con un comando del chat (`!ia pregunta`). Quien manda un regalo gana
 * prioridad (más monedas, antes); el resto espera su turno gratis (una cada N segundos, al azar).
 * Solo pregunta quien cumple lo que el streamer marque (seguir, compartir, Fan Club, regalo).
 */

export const AgentEligibilitySchema = z.object({
  /** quien sigue el canal */
  follow: z.boolean().default(true),
  /** quien compartió el LIVE en esta sesión */
  share: z.boolean().default(true),
  /** quien es del Fan Club ("Quiéreme") */
  fanClub: z.boolean().default(true),
  /** quien mandó un regalo (da prioridad según las monedas) */
  gift: z.boolean().default(true),
});
export type AgentEligibility = z.infer<typeof AgentEligibilitySchema>;

export const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** nombre con el que se presenta el agente */
  name: z.string().min(1).max(30).default("Asistente IA"),
  /** primera palabra del comentario que lo activa (p. ej. "!ia") */
  command: z.string().min(1).max(20).regex(/^\S+$/, "el comando no lleva espacios").default("!ia"),
  eligibility: AgentEligibilitySchema.default({}),
  /** una pregunta gratis cada tantos segundos (las de regalo no esperan) */
  freeEverySec: z.number().int().min(5).max(600).default(45),
  /** cuántos minutos vale el crédito que da un regalo para la siguiente pregunta de esa persona */
  giftCreditMin: z.number().int().min(1).max(120).default(10),
  /** preguntas que caben en la cola; las siguientes se descartan */
  maxQueue: z.number().int().min(5).max(200).default(50),
  /** largo máximo de una pregunta (lo demás se corta) */
  maxQuestionChars: z.number().int().min(20).max(300).default(150),
  style: OverlayStyleSchema.default({ designId: "panel" }),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const DEFAULT_AGENT_CONFIG: AgentConfig = AgentConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export const AgentQueueItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  question: z.string(),
  /** monedas que respaldan esta pregunta (0 = gratis) */
  coins: z.number().int().nonnegative(),
  at: z.number(),
});
export type AgentQueueItem = z.infer<typeof AgentQueueItemSchema>;

export const AgentCurrentSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  question: z.string(),
  coins: z.number().int().nonnegative(),
  /** vacío mientras el agente "piensa" */
  answer: z.string(),
  startedAt: z.number(),
  /** cuánto se queda la respuesta en pantalla (ms); 0 mientras piensa */
  showMs: z.number().int().nonnegative(),
});
export type AgentCurrent = z.infer<typeof AgentCurrentSchema>;

export const AgentStateSchema = z.object({
  /** cuántas preguntas esperan */
  queueSize: z.number().int().nonnegative(),
  /** las primeras de la fila (máx. 5), en el orden en que se atenderán las de regalo */
  queue: z.array(AgentQueueItemSchema),
  current: AgentCurrentSchema.optional(),
  /** a partir de cuándo (epoch ms) puede salir la siguiente pregunta gratis */
  nextFreeAt: z.number(),
  /** cuántas respuestas lleva en esta sesión */
  answered: z.number().int().nonnegative(),
  updatedAt: z.number(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentFileSchema = z.object({
  config: AgentConfigSchema.default({}),
});
export type AgentFile = z.infer<typeof AgentFileSchema>;

/**
 * Mensajes del canal WS `agente`.
 *  - `get-state`  cualquiera → sidecar
 *  - `state`      sidecar → todos: configuración y estado de la cola
 *  - `save`       UI → sidecar: cambia la configuración
 *  - `ask`        UI → sidecar: pregunta de prueba (con `coins` > 0 es "de regalo"); no pasa por el chat
 *  - `reset`      UI → sidecar: vacía la cola y la respuesta en pantalla
 *  - `error`      sidecar → UI
 */
export const AgentMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), config: AgentConfigSchema, state: AgentStateSchema, serverNow: z.number() }),
  z.object({ kind: z.literal("save"), config: AgentConfigSchema }),
  z.object({
    kind: z.literal("ask"),
    name: z.string().min(1).max(30),
    question: z.string().min(1).max(300),
    coins: z.number().int().min(0).max(1_000_000).default(0),
  }),
  z.object({ kind: z.literal("reset") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/** ¿El comentario empieza por el comando? Devuelve la pregunta (sin el comando), o undefined si no es para el agente. */
export function parseAgentCommand(command: string, text?: string): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  const space = t.search(/\s/);
  const first = space === -1 ? t : t.slice(0, space);
  if (first.toLowerCase() !== command.trim().toLowerCase()) return undefined;
  return space === -1 ? "" : t.slice(space + 1).trim();
}
