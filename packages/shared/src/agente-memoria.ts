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
});
export type ViewerMemory = z.infer<typeof ViewerMemorySchema>;

export const MAX_VIEWERS = 2000;

export const AgentMemoryFileSchema = z.object({
  version: z.literal(MEMORIA_VERSION).default(MEMORIA_VERSION),
  streamer: StreamerMemorySchema.default({}),
  viewers: z.record(ViewerMemorySchema).default({}),
});
export type AgentMemoryFile = z.infer<typeof AgentMemoryFileSchema>;

/** Canal `agente-memoria`: la app edita la ficha del streamer y ve cuántos viewers conoce el agente. */
export const AgentMemoryMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    streamer: StreamerMemorySchema,
    viewerCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("save-streamer"),
    name: z.string().trim().max(60),
    aliases: z.array(z.string().trim().min(1).max(40)).max(10),
  }),
  z.object({ kind: z.literal("add-fact"), text: z.string().trim().min(1).max(300) }),
  z.object({ kind: z.literal("remove-fact"), id: z.string().min(1) }),
  z.object({ kind: z.literal("clear-viewers") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AgentMemoryMessage = z.infer<typeof AgentMemoryMessageSchema>;
