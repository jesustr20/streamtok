import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type {
  Accion,
  Evento,
  EventoPorque,
  EventLogEntry,
  LiveEvent,
  ModAckPayload,
} from "@streamtok/shared";
import { requiresNameTag } from "@streamtok/shared";
import { EVENT_LABELS, reasonForCommandError } from "./event-log.js";
import type { ModBridge } from "./mod-bridge.js";

export type { Accion, Evento } from "@streamtok/shared";

/**
 * Motor genérico de Acciones y Eventos (ADR 0004). Reemplaza a `MappingEngine`
 * y a las reglas de comunidad: evalúa todos los Eventos activos del perfil
 * activo contra cada `LiveEvent`, y dispara las Acciones referenciadas.
 *
 * Emite `"event-log"` (EventLogEntry) por cada decisión que toma (Evento/Acción
 * disparados, o descarte y por qué) — ver issue #17.
 */

/** Etiquetas cortas en español para cada `porque` (mensajes del log). */
export const PORQUE_LABELS: Record<EventoPorque, string> = {
  unirse: "unirse",
  primeraActividad: "primera actividad",
  compartir: "compartir",
  seguir: "seguir",
  suscribirse: "suscribirse",
  likes: "likes",
  chat: "chat",
  comando: "comando",
  regaloValorMinimo: "regalo",
  regaloEspecifico: "regalo",
  emoteSuscriptor: "emote suscriptor",
  stickerFanClub: "sticker fan club",
  compraTiktokShop: "compra TikTok Shop",
  subeNivelFan: "sube de nivel de fan",
  subeNivelDonador: "sube de nivel de donador",
};

function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

/**
 * Calcula el ranking 1-based de un donante dentro de un mapa de monedas
 * acumuladas por handle. Usa ranking "dense": los empates comparten posición
 * (rank = 1 + cantidad de totales estrictamente mayores). Devuelve null si el
 * usuario no está registrado o no tiene monedas. Puro y testeable (issue #23).
 */
export function computeGifterRank(
  totals: ReadonlyMap<string, number>,
  username: string,
): number | null {
  const handle = normalizeHandle(username);
  const total = totals.get(handle);
  if (total === undefined || total <= 0) return null;
  const greater = new Set<number>();
  for (const value of totals.values()) {
    if (value > total) greater.add(value);
  }
  return greater.size + 1;
}

function sanitizeCommandParams(
  params: Record<string, unknown>,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class AccionesEventosEngine extends EventEmitter {
  private acciones: Accion[] = [];
  private eventos: Evento[] = [];
  /** Likes (taps) acumulados por Evento y por usuario, módulo N ("cada N likes"). */
  private likeCounts = new Map<string, number>();
  /** Monedas acumuladas por handle durante la sesión (ranking de donantes). */
  private gifterCoins = new Map<string, number>();

  constructor(private modBridge: ModBridge) {
    super();
  }

  setAcciones(acciones: Accion[]) {
    this.acciones = acciones;
  }

  getAcciones(): Accion[] {
    return this.acciones;
  }

  setEventos(eventos: Evento[]) {
    this.eventos = eventos;
    this.likeCounts.clear();
  }

  getEventos(): Evento[] {
    return this.eventos;
  }

  /** Reinicia el estado de sesión (ranking de donantes y umbral de likes).
   * Se invoca al iniciar una nueva sesión de LIVE. */
  resetSession() {
    this.gifterCoins.clear();
    this.likeCounts.clear();
  }

  private quienMatches(ev: Evento, live: LiveEvent): boolean {
    switch (ev.quien) {
      case "todos":
        return true;
      case "usuarioEspecifico":
        if (!ev.usuarioEspecifico) return false;
        return normalizeHandle(live.username) === normalizeHandle(ev.usuarioEspecifico);
      case "seguidor":
        return live.isFollower === true;
      case "suscriptor":
        return live.isSubscriber === true;
      case "moderador":
        return live.isModerator === true;
      case "donanteTop": {
        const n = ev.numeroDonantesTop ?? 1;
        if (n <= 0) return false;
        // Si TikTok reporta el puesto del usuario en el ranking de la sala, es
        // más fiable que el acumulado propio (que solo ve desde que conectamos).
        if (live.topGifterRank !== undefined) return live.topGifterRank <= n;
        const rank = computeGifterRank(this.gifterCoins, live.username);
        return rank !== null && rank <= n;
      }
    }
  }

  private porqueMatches(ev: Evento, live: LiveEvent): boolean {
    switch (ev.porque) {
      case "unirse":
        return live.event === "join";
      case "primeraActividad":
        return false; // tiktok-live-connector no expone señal de "primera interacción" (ADR 0005)
      case "compartir":
        return live.event === "share";
      case "seguir":
        return live.event === "follow";
      case "suscribirse":
        return live.event === "subscribe";
      case "likes":
        return live.event === "like";
      case "chat":
        return live.event === "comment";
      case "comando": {
        if (live.event !== "comment") return false;
        const command = (ev.comando ?? "").trim().toLowerCase();
        if (!command) return false;
        return live.text?.trim().toLowerCase().startsWith(command) ?? false;
      }
      case "regaloValorMinimo": {
        if (live.event !== "gift") return false;
        const min = ev.valorMinimoMonedas ?? 1;
        return (live.coins ?? 0) >= min;
      }
      case "regaloEspecifico": {
        if (live.event !== "gift") return false;
        if (ev.giftId && String(live.giftId ?? "") === ev.giftId) return true;
        if (ev.giftName && live.giftName === ev.giftName) return true;
        return false;
      }
      case "emoteSuscriptor":
        if (live.event !== "emote") return false;
        if (live.emoteScene !== "subscriber") return false;
        return !!ev.emoteId && live.emoteId === ev.emoteId;
      case "stickerFanClub":
        if (live.event !== "emote") return false;
        if (live.emoteScene !== "fanClub") return false;
        return !!ev.stickerId && live.emoteId === ev.stickerId;
      case "compraTiktokShop":
        return false; // oecLiveShopping no es una compra confirmada (ADR 0005)
      case "subeNivelFan":
        return live.event === "fanLevelUp" && (live.newLevel ?? 0) >= (ev.nivelMinimo ?? 1);
      case "subeNivelDonador":
        return live.event === "donorLevelUp" && (live.newLevel ?? 0) >= (ev.nivelMinimo ?? 1);
    }
  }

  /** `nivelEquipoRequerido` = nivel del Fan Club mínimo (ADR 0007). Solo aplica a
   * unirse / primera actividad / comando; con 0 (o ausente) no filtra, y un nivel
   * desconocido no alcanza un mínimo > 0. */
  private fanLevelOk(ev: Evento, live: LiveEvent): boolean {
    if (ev.porque !== "unirse" && ev.porque !== "primeraActividad" && ev.porque !== "comando") return true;
    const required = ev.nivelEquipoRequerido ?? 0;
    if (required <= 0) return true;
    return (live.fanLevel ?? 0) >= required;
  }

  private matchesEvento(ev: Evento, live: LiveEvent): boolean {
    return this.quienMatches(ev, live) && this.porqueMatches(ev, live) && this.fanLevelOk(ev, live);
  }

  /** Se llama por cada LiveEvent normalizado que llega del sidecar de TikTok. */
  async handleEvent(evt: LiveEvent) {
    // Regalo en mitad de combo: solo lo disparan las Acciones con
    // `repetirConComboDeRegalos: true`; el resto espera al cierre del combo.
    const giftInProgress = evt.event === "gift" && evt.repeatEnd === false;

    // Ranking de donantes: acumular monedas por usuario en la sesión (issue #23).
    // Solo se acumula el cierre del combo (el total), no los eventos intermedios.
    if (evt.event === "gift" && !giftInProgress && typeof evt.coins === "number" && evt.coins > 0) {
      const handle = normalizeHandle(evt.username);
      this.gifterCoins.set(handle, (this.gifterCoins.get(handle) ?? 0) + evt.coins);
    }

    let matched = false;
    let fired = false;

    for (const evento of this.eventos) {
      if (!evento.activo) continue;
      if (!this.matchesEvento(evento, evt)) continue;
      matched = true;

      // Umbral de likes ("cada N likes"): se acumulan los taps POR USUARIO y
      // solo se dispara al alcanzarlo (una vez por cada N completo).
      let times = 1;
      if (evento.porque === "likes" && evt.event === "like") {
        const n = Math.max(1, evento.cantidadMinimaLikes ?? 15);
        const key = `${evento.id}|${normalizeHandle(evt.username)}`;
        const total = (this.likeCounts.get(key) ?? 0) + (evt.likeCount ?? 1);
        times = Math.floor(total / n);
        this.likeCounts.set(key, total % n);
        if (times === 0) {
          this.emitEntry({
            status: "discarded",
            event: "like",
            reason: "like-threshold",
            eventoId: evento.id,
            message: `${evt.nickname ?? evt.username}: ${total}/${n} likes`,
          });
          continue;
        }
      }

      for (let i = 0; i < times; i++) {
        const didFire = await this.fireEvento(evento, evt, { onlyRepeat: giftInProgress });
        if (didFire) fired = true;
      }
    }

    if (giftInProgress && !fired) {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        reason: "gift-in-progress",
        message: "regalo en combo (se ignora hasta el fin del streak)",
      });
      return;
    }

    if (!matched) {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        reason: "no-match",
        message: `sin evento que coincida con ${EVENT_LABELS[evt.event]}`,
      });
    }
  }

  private async fireEvento(
    evento: Evento,
    evt: LiveEvent,
    opts: { onlyRepeat?: boolean } = {},
  ): Promise<boolean> {
    const ids = [
      ...evento.accionesTodas,
      ...(evento.accionesAleatorias.length > 0 ? [pickRandom(evento.accionesAleatorias)] : []),
    ];

    let fired = false;
    for (const accionId of ids) {
      const accion = this.acciones.find((a) => a.id === accionId);
      if (!accion) {
        this.emitEntry({
          status: "discarded",
          event: evt.event,
          reason: "accion-no-encontrada",
          eventoId: evento.id,
          message: `acción "${accionId}" no encontrada (¿fue borrada?)`,
        });
        continue;
      }
      // En un regalo intermedio de combo solo disparan las acciones que
      // repiten con cada regalo del combo; las demás esperan el cierre.
      if (opts.onlyRepeat && accion.repetirConComboDeRegalos !== true) {
        continue;
      }
      await this.executeAccion(evento, accion, evt);
      fired = true;
    }
    return fired;
  }

  private async executeAccion(evento: Evento, accion: Accion, evt: LiveEvent) {
    for (const comando of accion.comandos) {
      const ack = await this.dispatchCommand(comando.modActionId, comando.params, evt);
      this.emitCommandOutcome(ack, evt, {
        modActionId: comando.modActionId,
        accionId: accion.id,
        eventoId: evento.id,
        porque: evento.porque,
      });
    }
  }

  private async dispatchCommand(
    modActionId: string,
    params: Record<string, unknown>,
    evt: LiveEvent,
  ): Promise<ModAckPayload> {
    const nameTag = evt.nickname ?? evt.username;
    // Contrato: en arena_* y race_join/boost/rose la app DEBE mandar nameTag
    // (y coins vía params en arena).
    const opts: { nameTag?: string; notify?: string } = {};
    if (requiresNameTag(modActionId) || this.modBridge.getAction(modActionId)?.supportsNameTag) {
      opts.nameTag = nameTag;
    }

    return this.modBridge.sendCommand(modActionId, sanitizeCommandParams(params), opts);
  }

  private emitCommandOutcome(
    ack: ModAckPayload,
    evt: LiveEvent,
    ctx: { modActionId: string; accionId: string; eventoId: string; porque: EventoPorque },
  ) {
    if (ack.ok) {
      this.emitEntry({
        status: "fired",
        event: evt.event,
        action: ctx.modActionId,
        accionId: ctx.accionId,
        eventoId: ctx.eventoId,
        message: `${PORQUE_LABELS[ctx.porque]} → ${ctx.modActionId}`,
      });
    } else {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        action: ctx.modActionId,
        accionId: ctx.accionId,
        eventoId: ctx.eventoId,
        reason: reasonForCommandError(ack.error),
        message: `no se pudo enviar ${ctx.modActionId}: ${ack.error ?? "sin detalle"}`,
      });
    }
  }

  private emitEntry(entry: Omit<EventLogEntry, "id" | "at">) {
    this.emit("event-log", { id: nanoid(), at: Date.now(), ...entry } satisfies EventLogEntry);
  }
}
