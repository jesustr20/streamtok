import { z } from "zod";
import { ModAckPayloadSchema } from "./mod-protocol.js";

/**
 * Canal WS `manual-command` (UI ↔ sidecar). Permite que la UI dispare un
 * `mod-command` puntual (botón "Probar acción" en ActionsPanel) sin pasar por
 * el motor de mapeo. NO forma parte del protocolo del mod (mod-hello /
 * mod-command / mod-ack): es un concepto UI↔sidecar, por eso vive acá y no en
 * mod-protocol.ts.
 */

/**
 * Request (UI → sidecar). Los params se tipan con la unión número/string/bool
 * porque es exactamente lo que `ModBridge.sendCommand` (y por ende el
 * `ModCommandPayloadSchema` del mod) acepta; un valor de otro tipo se rechaza
 * en la validación con un error claro en vez de reventar dentro de
 * `sendCommand`.
 */
export const ManualCommandRequestSchema = z.object({
  action: z.string(),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  nameTag: z.string().optional(),
});
export type ManualCommandRequest = z.infer<typeof ManualCommandRequestSchema>;

/**
 * Response (sidecar → UI, mismo canal).
 *  - `ack`   resultado del comando (el ModAckPayload tal cual, incluso los
 *            errores de ejecución como "Mod no conectado" o timeout).
 *  - `error` rechazo de validación (request malformado).
 */
export const ManualCommandResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack"), ack: ModAckPayloadSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ManualCommandResponse = z.infer<typeof ManualCommandResponseSchema>;
