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
  | { ok: true; acciones: Accion[]; descartados: string[] }
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
 * referenciar una acción real del catálogo con params de tipo compatible.
 *
 * Un parámetro guardado que el mod YA NO define (p. ej. `enabled` de
 * `traffic_fast` tras actualizar el mod) no rechaza el guardado: se descarta
 * y se informa en `descartados`. Rechazarlo bloquearía cualquier edición de la
 * lista completa por una acción vieja y el usuario vería que "no guarda".
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

  if (!catalog) return { ok: true, acciones, descartados: [] };

  const errors: string[] = [];
  const descartados: string[] = [];
  const limpias = acciones.map((accion) => ({
    ...accion,
    comandos: accion.comandos.map((comando) => {
      const action = catalog.actions.find((a) => a.id === comando.modActionId);
      if (!action) {
        errors.push(
          `La acción "${accion.nombre}" (${accion.id}) referencia el comando "${comando.modActionId}", que no existe en el catálogo del mod.`,
        );
        return comando;
      }
      const conocidos = new Set(action.params.map((p) => p.name));
      const params: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(comando.params)) {
        if (conocidos.has(key)) params[key] = value;
        else descartados.push(`"${accion.nombre}" (${comando.modActionId}): ${key}`);
      }
      for (const err of validateActionParams(action, params)) {
        errors.push(`La acción "${accion.nombre}" (${accion.id}) ${err}`);
      }
      return { ...comando, params: params as typeof comando.params };
    }),
  }));

  return errors.length > 0 ? { ok: false, errors } : { ok: true, acciones: limpias, descartados };
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
