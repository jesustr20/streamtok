import { z } from "zod";

/**
 * Conexión al LIVE de TikTok controlada desde la UI (pantalla Inicio). NO
 * forma parte del contrato externo del mod (mod-protocol.ts) ni del LiveEvent
 * (live-event.ts): es un dominio propio UI↔sidecar.
 *
 * Canal WS `tiktok-connection`:
 *  - `get-state`   UI → sidecar: pedir el estado actual.
 *  - `connect`     UI → sidecar: conectar al LIVE de `username` (con o sin @).
 *                  Si ya había una conexión, se cierra antes.
 *  - `disconnect`  UI → sidecar: cortar la conexión y cerrar la grabación.
 *  - `state`       sidecar → UI: estado vigente (broadcast en cada cambio, a
 *                  clientes que conectan tarde y en respuesta a `get-state`).
 *                  Mientras hay conexión se reenvía ~1 vez por segundo si
 *                  cambió `recordedEvents`.
 */
export const TiktokConnectionStatusSchema = z.enum(["idle", "connecting", "connected", "error"]);
export type TiktokConnectionStatus = z.infer<typeof TiktokConnectionStatusSchema>;

export const TiktokConnectionStateSchema = z.object({
  status: TiktokConnectionStatusSchema,
  /** LIVE al que se está conectando / conectado (sin @). */
  username: z.string().optional(),
  /** Archivo donde se graban los eventos crudos de esta conexión. */
  recordingPath: z.string().optional(),
  /** Mensajes crudos grabados en esta conexión. */
  recordedEvents: z.number().int().nonnegative(),
  /** Motivo del último fallo o corte (solo con status "error"). */
  error: z.string().optional(),
});
export type TiktokConnectionState = z.infer<typeof TiktokConnectionStateSchema>;

export const TiktokConnectionMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("connect"), username: z.string() }),
  z.object({ kind: z.literal("disconnect") }),
  z.object({ kind: z.literal("state"), state: TiktokConnectionStateSchema }),
]);
export type TiktokConnectionMessage = z.infer<typeof TiktokConnectionMessageSchema>;
