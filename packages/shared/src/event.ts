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

export const EventoModoDisparoSchema = z.enum(["todas", "unaAlAzar"]);
export type EventoModoDisparo = z.infer<typeof EventoModoDisparoSchema>;

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
  modoDisparo: EventoModoDisparoSchema,
  accionesIds: z.array(z.string()).min(1),
});

export const EventoSchema = baseSchema.superRefine((evt, ctx) => {
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
      if (!evt.giftId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["giftId"],
          message: 'porque "regaloEspecifico" requiere "giftId".',
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
});
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
