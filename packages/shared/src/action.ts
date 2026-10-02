import { z } from "zod";

/**
 * Acción (ADR 0004). Concepto UI↔sidecar, NO en mod-protocol.ts. Es "qué pasa":
 * una Acción agrupa uno o más comandos del mod (`comandos`). Un Evento
 * referencia una o más Acciones por `id`.
 */

/** Un comando del mod dentro de una Acción. */
export const AccionComandoSchema = z.object({
  /** id de la acción del catálogo del mod-hello. */
  modActionId: z.string(),
  /** params estáticos; se validan contra el catálogo real del mod. */
  params: z.record(z.string(), z.unknown()),
  /** (informativo por ahora) cuántas veces repetir el comando. */
  cantidad: z.number().optional(),
  /** (informativo por ahora) intervalo entre repeticiones. */
  intervaloMs: z.number().optional(),
});
export type AccionComando = z.infer<typeof AccionComandoSchema>;

export const AccionMediaSchema = z.object({
  animacion: z.boolean(),
  imagen: z.boolean(),
  sonido: z.boolean(),
  video: z.boolean(),
});
export type AccionMedia = z.infer<typeof AccionMediaSchema>;

export const AccionSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  descripcion: z.string(),
  /** duración en segundos; 0 = sin duración. */
  duracionSeg: z.number(),
  /** puntos (positivo o negativo). Sin sistema de puntos aún: solo se guarda. */
  puntos: z.number(),
  /** referencia a una "Screen" del overlay (aún sin servidor de overlay: solo se guarda). */
  pantalla: z.string().nullable(),
  /** flags informativos de media (aún sin subida real de archivos). */
  media: AccionMediaSchema,
  /** lista de comandos del mod a ejecutar. */
  comandos: z.array(AccionComandoSchema),
  /** si es true, un Evento de regalo la dispara en CADA regalo del combo
   * (incluyendo los intermedios con repeatEnd: false), no solo al final. */
  repetirConComboDeRegalos: z.boolean().optional().default(false),
});
export type Accion = z.infer<typeof AccionSchema>;

/**
 * Canal WS `acciones` (UI ↔ sidecar), mismo patrón que el viejo `mapping-rules`:
 *  - `set`     UI → sidecar: la lista completa de acciones del perfil activo.
 *  - `update`  sidecar → UI: la lista vigente (broadcast y a clientes tardíos).
 *  - `error`   sidecar → UI: rechazo de un `set` inválido.
 */
export const AccionesMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), acciones: z.array(AccionSchema) }),
  z.object({ kind: z.literal("update"), acciones: z.array(AccionSchema) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AccionesMessage = z.infer<typeof AccionesMessageSchema>;
