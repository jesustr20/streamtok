import type {
  EventLogEntry,
  EventLogReason,
  LiveEventTypeT,
} from "@streamtok/shared";

/**
 * Cola de eventos (issue #17). Funciones/estructuras puras reutilizables para
 * armar las entradas y acotar el buffer. La emisión vive en
 * `AccionesEventosEngine` (acciones-eventos-engine.ts) y la persistencia del
 * buffer + canal WS en `ProfilesController` (profiles.ts). No hay persistencia
 * en disco: es in-memory y se pierde al reiniciar el sidecar.
 */

/** Tamaño máximo de la cola (entradas más viejas se descartan). */
export const EVENT_LOG_LIMIT = 50;

/** Etiquetas cortas en español para cada tipo de LiveEvent (mensajes del log). */
export const EVENT_LABELS: Record<LiveEventTypeT, string> = {
  gift: "regalo",
  like: "like",
  comment: "comentario",
  follow: "follow",
  share: "compartir",
  join: "entrada al live",
  subscribe: "suscripción",
  emote: "emote/sticker",
};

/**
 * Traduce el error de un `mod-ack` fallido a un motivo de descarte estable.
 * Solo mapea los errores que `ModBridge.sendCommand` (o el mod) puede producir.
 */
export function reasonForCommandError(error?: string): EventLogReason {
  if (error === "Mod no conectado") return "mod-not-connected";
  if (error?.includes("demasiados comandos")) return "queue-full";
  if (error?.startsWith("Timeout")) return "ack-timeout";
  return "command-error";
}

/**
 * Ring buffer acotado de entradas (más viejo primero). No se persiste.
 */
export class EventLogBuffer {
  private entries: EventLogEntry[] = [];

  constructor(private readonly limit = EVENT_LOG_LIMIT) {}

  append(entry: EventLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  getEntries(): EventLogEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
  }
}
