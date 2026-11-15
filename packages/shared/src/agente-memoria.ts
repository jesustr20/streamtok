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

/** Un dato de un viewer, aprendido de lo que él mismo dijo al agente. Nunca sensible (ADR 0024, §4). */
export const ViewerFactSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(120),
  at: z.number().int().nonnegative().default(0),
});
export type ViewerFact = z.infer<typeof ViewerFactSchema>;
export const MAX_VIEWER_FACTS = 8;
/** días sin verlo tras los que se olvida a un viewer */
export const VIEWER_TTL_DAYS = 60;
export const MAX_OPTOUT = 500;

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
  /** datos que el agente aprendió de él (con el modelo, en lotes) */
  facts: z.array(ViewerFactSchema).max(MAX_VIEWER_FACTS).default([]),
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

export const MAX_PENDIENTES = 30;

/** Algo del streamer que el agente no supo contestar y le quiere preguntar (ADR 0024, §3). Se borra al contestar o descartar. */
export const PendienteSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().trim().min(1).max(300),
  /** quién lo preguntó en el chat (nombre visible) */
  asker: z.string().trim().max(60).default(""),
  at: z.number().int().nonnegative().default(0),
});
export type Pendiente = z.infer<typeof PendienteSchema>;

export const AgentMemoryFileSchema = z.object({
  version: z.literal(MEMORIA_VERSION).default(MEMORIA_VERSION),
  streamer: StreamerMemorySchema.default({}),
  viewers: z.record(ViewerMemorySchema).default({}),
  conductas: z.array(ConductaSchema).max(MAX_CONDUCTAS).default([]),
  pendientes: z.array(PendienteSchema).max(MAX_PENDIENTES).default([]),
  /** viewers que escribieron «!olvidame»: no se aprende nada más de ellos */
  optOut: z.array(z.string().max(60)).max(MAX_OPTOUT).default([]),
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
    /** preguntas de viewers sobre el streamer que el agente no supo contestar y espera que él responda */
    pendientes: z.array(PendienteSchema).default([]),
    /** viewers con datos aprendidos, los más recientes primero (para revisarlos y borrarlos) */
    viewersConDatos: z.array(z.object({ handle: z.string(), name: z.string(), facts: z.array(ViewerFactSchema) })).default([]),
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
  /** el streamer contesta una pregunta pendiente: se guarda como hecho suyo y el agente responde a quien preguntó */
  z.object({ kind: z.literal("remove-viewer-fact"), handle: z.string().min(1), id: z.string().min(1) }),
  z.object({ kind: z.literal("remove-viewer"), handle: z.string().min(1) }),
  z.object({ kind: z.literal("answer-pending"), id: z.string().min(1), text: z.string().trim().min(1).max(250) }),
  /** descartar una pregunta pendiente; `decline` = «No quiero contestar» (el agente lo dice con naturalidad) */
  z.object({ kind: z.literal("dismiss-pending"), id: z.string().min(1), decline: z.boolean().default(false) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AgentMemoryMessage = z.infer<typeof AgentMemoryMessageSchema>;
