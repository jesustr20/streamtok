import {
  AccionSchema,
  EventoSchema,
  type Accion,
  type Evento,
  type ModHelloPayload,
} from "@streamtok/shared";
import { formatZodError, validateActionParams } from "./mapping-rules.js";

/**
 * Validación y normalización de Acciones y Eventos (ADR 0004). Funciones puras
 * reutilizables; la persistencia y el manejo de canales WS viven en profiles.ts.
 */

export type AccionesValidationResult =
  | { ok: true; acciones: Accion[] }
  | { ok: false; errors: string[] };

export type EventosValidationResult =
  | { ok: true; eventos: Evento[] }
  | { ok: false; errors: string[] };

/**
 * Aplica los defaults documentados de un Evento (según `porque` y `quien`),
 * para que lo que se persiste sea canónico. El motor igual usa `?? default`
 * como defensa.
 */
export function normalizeEvento(e: Evento): Evento {
  const out: Evento = { ...e };
  if (e.porque === "unirse" || e.porque === "primeraActividad" || e.porque === "comando") {
    out.nivelEquipoRequerido = e.nivelEquipoRequerido ?? 0;
  }
  if (e.porque === "comando") {
    out.nivelPuntosRequerido = e.nivelPuntosRequerido ?? 0;
  }
  if (e.porque === "likes") {
    out.cantidadMinimaLikes = e.cantidadMinimaLikes ?? 15;
  }
  if (e.porque === "regaloValorMinimo") {
    out.valorMinimoMonedas = e.valorMinimoMonedas ?? 1;
  }
  if (e.quien === "donanteTop") {
    out.numeroDonantesTop = e.numeroDonantesTop ?? 3;
  }
  return out;
}

/**
 * Valida una lista de Acciones. Estructuralmente contra `AccionSchema` y, si
 * hay catálogo del mod conectado, semánticamente: cada `comando` debe
 * referenciar una acción real del catálogo con params compatibles.
 */
export function validateAcciones(
  input: unknown,
  catalog: ModHelloPayload | null,
): AccionesValidationResult {
  const parsed = AccionSchema.array().safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: [formatZodError(parsed.error)] };
  }
  const acciones = parsed.data;

  if (!catalog) return { ok: true, acciones };

  const errors: string[] = [];
  for (const accion of acciones) {
    for (const comando of accion.comandos) {
      const action = catalog.actions.find((a) => a.id === comando.modActionId);
      if (!action) {
        errors.push(
          `La acción "${accion.nombre}" (${accion.id}) referencia el comando "${comando.modActionId}", que no existe en el catálogo del mod.`,
        );
        continue;
      }
      for (const err of validateActionParams(action, comando.params)) {
        errors.push(`La acción "${accion.nombre}" (${accion.id}) ${err}`);
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, acciones };
}

/**
 * Valida una lista de Eventos. Estructuralmente contra `EventoSchema` y aplica
 * defaults. No valida que `accionesTodas`/`accionesAleatorias` apunten a
 * Acciones existentes: si un Evento referencia una Acción borrada, el motor lo
 * reporta en runtime como `accion-no-encontrada` (no se rechaza el `set`
 * completo por eso).
 */
export function validateEventos(input: unknown): EventosValidationResult {
  const parsed = EventoSchema.array().safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: [formatZodError(parsed.error)] };
  }
  return { ok: true, eventos: parsed.data.map(normalizeEvento) };
}
