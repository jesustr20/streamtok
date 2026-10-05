import { z } from "zod";

/**
 * Evento (ADR 0004). Concepto UI↔sidecar, NO en mod-protocol.ts. Es "qué lo
 * dispara": un Evento referencia una o más Acciones por `id`. La matriz
 * condicional de `quien` y `porque` se valida con `.superRefine`.
 */

export const EventoQuienSchema = z.enum([
  "todos",
  "seguidor",
  "suscriptor",
  "moderador",
  "donanteTop",
  "usuarioEspecifico",
]);
export type EventoQuien = z.infer<typeof EventoQuienSchema>;

export const EventoPorqueSchema = z.enum([
  "unirse",
  "primeraActividad",
  "compartir",
  "seguir",
  "suscribirse",
  "likes",
  "chat",
  "comando",
  "regaloValorMinimo",
  "regaloEspecifico",
  "emoteSuscriptor",
  "stickerFanClub",
  "compraTiktokShop",
]);
export type EventoPorque = z.infer<typeof EventoPorqueSchema>;

const baseSchema = z.object({
  id: z.string(),
  activo: z.boolean(),
  quien: EventoQuienSchema,
  usuarioEspecifico: z.string().optional(),
  numeroDonantesTop: z.number().optional(),
  porque: EventoPorqueSchema,
  nivelEquipoRequerido: z.number().optional(),
  nivelPuntosRequerido: z.number().optional(),
  comando: z.string().optional(),
  cantidadMinimaLikes: z.number().optional(),
  valorMinimoMonedas: z.number().optional(),
  giftId: z.string().optional(),
  giftName: z.string().optional(),
  emoteId: z.string().optional(),
  stickerId: z.string().optional(),
  nombreProductoContiene: z.string().optional(),
  /** Acciones que se disparan TODAS al coincidir el evento. */
  accionesTodas: z.array(z.string()).default([]),
  /** Acciones de las que se dispara UNA al azar (si no está vacío). */
  accionesAleatorias: z.array(z.string()).default([]),
});

/**
 * Migra Eventos persistidos con el schema viejo (`modoDisparo` + `accionesIds`)
 * al nuevo (`accionesTodas` + `accionesAleatorias`). Idempotente.
 */
function migrateEventoAcciones(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if ("accionesTodas" in obj || "accionesAleatorias" in obj) return input;
  if (!Array.isArray(obj.accionesIds)) return input;
  const { modoDisparo, accionesIds, ...rest } = obj;
  if (modoDisparo === "unaAlAzar") {
    return { ...rest, accionesTodas: [], accionesAleatorias: accionesIds };
  }
  return { ...rest, accionesTodas: accionesIds, accionesAleatorias: [] };
}

export const EventoSchema = z.preprocess(migrateEventoAcciones, baseSchema.superRefine((evt, ctx) => {
  // --- matriz de `quien` ---
  if (evt.quien === "usuarioEspecifico" && !evt.usuarioEspecifico) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["usuarioEspecifico"],
      message: 'quien "usuarioEspecifico" requiere "usuarioEspecifico".',
    });
  }

  // --- matriz de `porque` (cada caso tiene su rama) ---
  switch (evt.porque) {
    case "unirse":
      // nivelEquipoRequerido opcional (default 0)
      break;
    case "primeraActividad":
      // nivelEquipoRequerido opcional (default 0)
      break;
    case "compartir":
      break;
    case "seguir":
      break;
    case "suscribirse":
      break;
    case "likes":
      // cantidadMinimaLikes opcional (default 15)
      break;
    case "chat":
      break;
    case "comando": {
      if (!evt.comando) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["comando"],
          message: 'porque "comando" requiere "comando".',
        });
      } else if (!/^[!/]/.test(evt.comando)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["comando"],
          message: '"comando" debe empezar con "!" o "/".',
        });
      }
      break;
    }
    case "regaloValorMinimo":
      // valorMinimoMonedas opcional (default 1)
      break;
    case "regaloEspecifico": {
      // Los regalos sembrados del catálogo estático aún no tienen id (solo
      // nombre): el motor ya empareja por id O por nombre.
      if (!evt.giftId && !evt.giftName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["giftId"],
          message: 'porque "regaloEspecifico" requiere "giftId" o "giftName".',
        });
      }
      break;
    }
    case "emoteSuscriptor": {
      if (!evt.emoteId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["emoteId"],
          message: 'porque "emoteSuscriptor" requiere "emoteId".',
        });
      }
      break;
    }
    case "stickerFanClub": {
      if (!evt.stickerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stickerId"],
          message: 'porque "stickerFanClub" requiere "stickerId".',
        });
      }
      break;
    }
    case "compraTiktokShop": {
      if (!evt.nombreProductoContiene) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nombreProductoContiene"],
          message: 'porque "compraTiktokShop" requiere "nombreProductoContiene".',
        });
      }
      break;
    }
  }
}));
export type Evento = z.infer<typeof EventoSchema>;

/**
 * Canal WS `eventos` (UI ↔ sidecar), mismo patrón que `acciones`:
 *  - `set`     UI → sidecar: la lista completa de eventos del perfil activo.
 *  - `update`  sidecar → UI: la lista vigente.
 *  - `error`   sidecar → UI: rechazo de un `set` inválido.
 */
export const EventosMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), eventos: z.array(EventoSchema) }),
  z.object({ kind: z.literal("update"), eventos: z.array(EventoSchema) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type EventosMessage = z.infer<typeof EventosMessageSchema>;
