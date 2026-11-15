import { z } from "zod";

/**
 * Memoria del agente IA (ADR 0024, fase 1). Vive en `agente-memoria.json`, aparte de `agente.json`.
 * Guarda lo que el agente sabe del streamer y de los viewers. Todo lo que escribe un viewer es DATO,
 * nunca una instrucción. No se guarda nada sensible (lo prohíbe el ADR; las fases siguientes lo aplican).
 */

export const MEMORIA_VERSION = 1;

/** Un hecho del streamer: lo escribe el streamer (o lo responde cuando el agente le pregunta). */
export const StreamerFactSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(300),
  /** cuándo se anotó (ms desde 1970) */
  at: z.number().int().nonnegative().default(0),
});
export type StreamerFact = z.infer<typeof StreamerFactSchema>;

export const StreamerMemorySchema = z.object({
  /** nombre con el que se conoce al dueño del LIVE (de la cuenta conectada; editable) */
  name: z.string().trim().max(60).default(""),
  /** @usuario de TikTok del dueño, sin la arroba */
  handle: z.string().trim().max(60).default(""),
  /** otros nombres o apodos por los que lo llaman */
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  facts: z.array(StreamerFactSchema).max(100).default([]),
});
export type StreamerMemory = z.infer<typeof StreamerMemorySchema>;

/** Un viewer que el agente ya vio. Solo datos básicos (sin modelo, siempre). */
export const ViewerMemorySchema = z.object({
  handle: z.string().min(1).max(60),
  name: z.string().trim().max(60).default(""),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative().default(0),
  lastQuestion: z.string().max(200).default(""),
  /** intentos de manipular o provocar al agente en este LIVE (ADR 0024, §7); se reinicia con cada LIVE nuevo */
  strikes: z.number().int().nonnegative().default(0),
  /** el agente ya no atiende a este viewer el resto del LIVE (al llegar a STRIKE_LIMIT, o a mano) */
  ignored: z.boolean().default(false),
});
export type ViewerMemory = z.infer<typeof ViewerMemorySchema>;

export const MAX_VIEWERS = 2000;
/** a la tercera falta el viewer queda ignorado el resto del LIVE */
export const STRIKE_LIMIT = 3;
export const MAX_CONDUCTAS = 30;

/** Una conducta aprendida: un patrón que el streamer marcó con «Parar IA» y que el agente evita (ADR 0024, §7). */
export const ConductaSchema = z.object({
  id: z.string().min(1).max(40),
  /** descripción de una línea del patrón (la escribe el modelo al aprender, o el propio mensaje si no había modelo) */
  pattern: z.string().trim().min(1).max(200),
  /** el mensaje que la originó, recortado */
  example: z.string().max(200).default(""),
  at: z.number().int().nonnegative().default(0),
});
export type Conducta = z.infer<typeof ConductaSchema>;

export const AgentMemoryFileSchema = z.object({
  version: z.literal(MEMORIA_VERSION).default(MEMORIA_VERSION),
  streamer: StreamerMemorySchema.default({}),
  viewers: z.record(ViewerMemorySchema).default({}),
  conductas: z.array(ConductaSchema).max(MAX_CONDUCTAS).default([]),
});
export type AgentMemoryFile = z.infer<typeof AgentMemoryFileSchema>;

/** Canal `agente-memoria`: la app edita la ficha del streamer y ve cuántos viewers conoce el agente. */
export const AgentMemoryMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    streamer: StreamerMemorySchema,
    viewerCount: z.number().int().nonnegative(),
    conductas: z.array(ConductaSchema).default([]),
    /** viewers que el agente ignora en este LIVE */
    ignored: z.array(z.object({ handle: z.string(), name: z.string(), strikes: z.number().int().nonnegative() })).default([]),
  }),
  z.object({
    kind: z.literal("save-streamer"),
    name: z.string().trim().max(60),
    aliases: z.array(z.string().trim().min(1).max(40)).max(10),
  }),
  z.object({ kind: z.literal("add-fact"), text: z.string().trim().min(1).max(300) }),
  z.object({ kind: z.literal("remove-fact"), id: z.string().min(1) }),
  z.object({ kind: z.literal("clear-viewers") }),
  z.object({ kind: z.literal("remove-conducta"), id: z.string().min(1) }),
  z.object({ kind: z.literal("forgive-viewer"), handle: z.string().min(1) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AgentMemoryMessage = z.infer<typeof AgentMemoryMessageSchema>;
