import { z } from "zod";
import { CommunityRuleKindSchema } from "./community-rule.js";
import { LiveEventType } from "./live-event.js";

/**
 * Cola de eventos ("Eventos y Cola", issue #17). Concepto UI↔sidecar, NO en
 * mod-protocol.ts. Es un log in-memory, acotado y sin persistencia: el sidecar
 * emite una entrada por cada "decisión" que toma al evaluar un LiveEvent
 * (regla de mapeo/regla de comunidad disparada, o descarte y por qué).
 */

/**
 * Estado de la entrada. `fired` = se disparó una acción (el mod-ack fue ok);
 * `discarded` = el evento (o el envío del comando) se descartó.
 */
export const EventLogStatusSchema = z.enum(["fired", "discarded"]);
export type EventLogStatus = z.infer<typeof EventLogStatusSchema>;

/**
 * Motivos de descarte. Todos corresponden a lógica real del `MappingEngine`:
 *  - gift-in-progress  evento gift en mitad de un streak (repeatEnd false)
 *  - no-match          ninguna regla/slot coincidió
 *  - like-threshold    like por debajo del umbral "cada N likes"
 *  - mod-not-connected sendCommand devolvió "Mod no conectado"
 *  - queue-full        sendCommand devolvió cola llena (límite de 300)
 *  - ack-timeout       sendCommand expiró esperando mod-ack
 *  - command-error     sendCommand falló con otro error del ack
 */
export const EventLogReasonSchema = z.enum([
  "gift-in-progress",
  "no-match",
  "like-threshold",
  "mod-not-connected",
  "queue-full",
  "ack-timeout",
  "command-error",
]);
export type EventLogReason = z.infer<typeof EventLogReasonSchema>;

export const EventLogEntrySchema = z.object({
  id: z.string(),
  /** epoch ms (Date.now()) en el momento de emitir. */
  at: z.number(),
  status: EventLogStatusSchema,
  /** tipo del evento evaluado. */
  event: LiveEventType,
  /** descripción corta en español para mostrar tal cual. */
  message: z.string(),
  /** id de acción del mod (si se intentó disparar). */
  action: z.string().optional(),
  /** id de la regla de mapeo que coincidió (si aplica). */
  ruleId: z.string().optional(),
  /** slot de comunidad que coincidió (si aplica). */
  communityKind: CommunityRuleKindSchema.optional(),
  /** motivo, presente solo cuando status === "discarded". */
  reason: EventLogReasonSchema.optional(),
});
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

/**
 * Canal WS `event-log` (sidecar → UI, unidireccional):
 *  - `append`   una entrada nueva, broadcast al momento.
 *  - `snapshot` la cola completa vigente (más viejo primero), enviada a un
 *               cliente que se conecta tarde o tras cambiar de perfil activo.
 */
export const EventLogMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("append"), entry: EventLogEntrySchema }),
  z.object({ kind: z.literal("snapshot"), entries: z.array(EventLogEntrySchema) }),
]);
export type EventLogMessage = z.infer<typeof EventLogMessageSchema>;
