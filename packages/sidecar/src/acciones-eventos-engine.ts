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

/**
 * Resumen corto del evento para el log: en regalos incluye nombre, id y monedas
 * (así se ve de un vistazo qué llegó y por qué coincidió o no con un Evento).
 */
export function describeLiveEvent(evt: LiveEvent): string {
  const who = evt.nickname ?? evt.username;
  if (evt.event === "gift") {
    const bits = [
      evt.giftId !== undefined ? `id ${evt.giftId}` : null,
      typeof evt.coins === "number" ? `${evt.coins} monedas` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return `regalo ${evt.giftName ?? "?"}${bits ? ` (${bits})` : ""} de ${who}`;
  }
  return `${EVENT_LABELS[evt.event]} de ${who}`;
}

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
  /** Veces que una acción "repetir con combo" YA se ejecutó en el streak actual
   * (clave evento|acción|usuario|regalo → cantidad de regalos cubiertos). Cada
   * mensaje ejecuta solo la diferencia con `repeatCount`; se borra al cerrar. */
  private streakFired = new Map<string, number>();
  /** Monedas acumuladas por handle durante la sesión (ranking de donantes). */
  private gifterCoins = new Map<string, number>();
  /** Cooldowns (ADR 0010): epoch ms hasta el que sigue bloqueada una acción
   * (global, clave accionId) o una acción para un usuario (clave accionId|handle). */
  private cooldownGlobalUntil = new Map<string, number>();
  private cooldownUserUntil = new Map<string, number>();

  constructor(private modBridge: ModBridge) {
    super();
  }

  setAcciones(acciones: Accion[]) {
    // Cooldowns (ADR 0010): se reinician los de las acciones borradas o cuyos
    // segundos cambiaron; editar otra cosa (nombre, comandos) no los toca.
    const next = new Map(acciones.map((a) => [a.id, a]));
    for (const prev of this.acciones) {
      const now = next.get(prev.id);
      if (
        !now ||
        (now.cooldownGlobalSeg ?? 0) !== (prev.cooldownGlobalSeg ?? 0) ||
        (now.cooldownUsuarioSeg ?? 0) !== (prev.cooldownUsuarioSeg ?? 0)
      ) {
        this.clearCooldowns(prev.id);
      }
    }
    this.acciones = acciones;
  }

  private clearCooldowns(accionId: string) {
    this.cooldownGlobalUntil.delete(accionId);
    const prefix = `${accionId}|`;
    for (const k of [...this.cooldownUserUntil.keys()]) if (k.startsWith(prefix)) this.cooldownUserUntil.delete(k);
  }

  getAcciones(): Accion[] {
    return this.acciones;
  }

  setEventos(eventos: Evento[]) {
    this.eventos = eventos;
    this.likeCounts.clear();
    this.streakFired.clear();
  }

  getEventos(): Evento[] {
    return this.eventos;
  }

  /** Reinicia el estado de sesión (ranking de donantes y umbral de likes).
   * Se invoca al iniciar una nueva sesión de LIVE. */
  resetSession() {
    this.gifterCoins.clear();
    this.likeCounts.clear();
    this.streakFired.clear();
    this.cooldownGlobalUntil.clear();
    this.cooldownUserUntil.clear();
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

    // Cierre de un streak (o regalo suelto): las acciones "repetir con combo"
    // que ya dispararon con un mensaje en curso no se repiten otra vez aquí.
    const giftClosing = evt.event === "gift" && evt.repeatEnd === true;
    // Sin `repeatEnd` (fuente que no informa streaks) no hay streak que seguir.
    const streakKey =
      evt.event === "gift" && evt.repeatEnd !== undefined
        ? `${normalizeHandle(evt.username)}|${evt.giftId ?? evt.giftName ?? "?"}`
        : undefined;

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
        const didFire = await this.fireEvento(evento, evt, {
          onlyRepeat: giftInProgress,
          streakKey,
        });
        if (didFire) fired = true;
      }
    }

    // El streak terminó: olvidar qué acciones ya se repitieron en él.
    if (giftClosing && streakKey) {
      const suffix = `|${streakKey}`;
      for (const k of [...this.streakFired.keys()]) if (k.endsWith(suffix)) this.streakFired.delete(k);
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
        message: `sin evento que coincida con ${describeLiveEvent(evt)}`,
      });
    }
  }

  private async fireEvento(
    evento: Evento,
    evt: LiveEvent,
    opts: { onlyRepeat?: boolean; streakKey?: string } = {},
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
      // "Repetir con combo": se ejecuta UNA vez por cada regalo del streak. TikTok
      // manda el combo en varios mensajes con la cantidad acumulada (1, 3, 4, 5…)
      // y un cierre con el total, así que cada mensaje ejecuta solo los regalos
      // nuevos desde el anterior (ADR 0009). Una rosa suelta (en curso + cierre)
      // = 1 ejecución, no 2.
      let times = 1;
      if (accion.repetirConComboDeRegalos === true && evt.event === "gift" && !opts.streakKey) {
        times = evt.repeatCount ?? 1; // regalo sin información de streak: tantas como regalos
      } else if (accion.repetirConComboDeRegalos === true && opts.streakKey) {
        const repeatKey = `${evento.id}|${accion.id}|${opts.streakKey}`;
        const total = evt.repeatCount ?? 1;
        // Si la cantidad baja, empezó un streak nuevo y el cierre del anterior se perdió.
        const prev = this.streakFired.get(repeatKey) ?? 0;
        const already = total < prev ? 0 : prev;
        times = Math.max(0, total - already);
        if (times === 0) continue;
        if (this.streakFired.size > 2000) this.streakFired.clear(); // streaks abandonados
        this.streakFired.set(repeatKey, already + times);
      }
      // Cooldown (ADR 0010). Va DESPUÉS del conteo del streak: lo bloqueado cuenta
      // como ya procesado y no se ejecuta en bloque cuando termine el cooldown.
      const handle = normalizeHandle(evt.username);
      const now = Date.now();
      const blocked = this.cooldownRemaining(accion, handle, now);
      if (blocked) {
        const who = blocked.kind === "global" ? "global" : `de ${evt.nickname ?? evt.username}`;
        this.emitEntry({
          status: "discarded",
          event: evt.event,
          reason: "cooldown",
          accionId: accion.id,
          eventoId: evento.id,
          message: `cooldown ${who} de "${accion.nombre}": faltan ${Math.ceil(blocked.remainingMs / 1000)} s`,
        });
        continue;
      }
      // Se reserva ANTES de enviar: dos eventos casi simultáneos no pasan los dos.
      const reservation = this.reserveCooldown(accion, handle, now);
      let anyOk = false;
      for (let i = 0; i < times; i++) {
        if (await this.executeAccion(evento, accion, evt)) anyOk = true;
      }
      // Si el mod rechazó todos los comandos, la acción no se ejecutó de verdad.
      if (!anyOk) this.releaseCooldown(reservation);
      fired = true;
    }
    return fired;
  }

  /** Cuánto falta para que `accion` pueda correr para `handle` (null = libre). */
  private cooldownRemaining(
    accion: Accion,
    handle: string,
    now: number,
  ): { kind: "global" | "usuario"; remainingMs: number } | null {
    const global = this.cooldownGlobalUntil.get(accion.id) ?? 0;
    if (global > now) return { kind: "global", remainingMs: global - now };
    const user = this.cooldownUserUntil.get(`${accion.id}|${handle}`) ?? 0;
    if (user > now) return { kind: "usuario", remainingMs: user - now };
    return null;
  }

  private reserveCooldown(accion: Accion, handle: string, now: number) {
    const userKey = `${accion.id}|${handle}`;
    const reservation = {
      accionId: accion.id,
      userKey,
      prevGlobal: this.cooldownGlobalUntil.get(accion.id),
      prevUser: this.cooldownUserUntil.get(userKey),
    };
    const globalSeg = accion.cooldownGlobalSeg ?? 0;
    const userSeg = accion.cooldownUsuarioSeg ?? 0;
    if (globalSeg > 0) this.cooldownGlobalUntil.set(accion.id, now + globalSeg * 1000);
    if (userSeg > 0) {
      if (this.cooldownUserUntil.size > 5000) {
        for (const [k, until] of this.cooldownUserUntil) if (until <= now) this.cooldownUserUntil.delete(k);
      }
      this.cooldownUserUntil.set(userKey, now + userSeg * 1000);
    }
    return reservation;
  }

  private releaseCooldown(r: { accionId: string; userKey: string; prevGlobal?: number; prevUser?: number }) {
    if (r.prevGlobal === undefined) this.cooldownGlobalUntil.delete(r.accionId);
    else this.cooldownGlobalUntil.set(r.accionId, r.prevGlobal);
    if (r.prevUser === undefined) this.cooldownUserUntil.delete(r.userKey);
    else this.cooldownUserUntil.set(r.userKey, r.prevUser);
  }

  /** Devuelve true si al menos un comando de la acción fue aceptado por el mod. */
  private async executeAccion(evento: Evento, accion: Accion, evt: LiveEvent): Promise<boolean> {
    let anyOk = false;
    for (const comando of accion.comandos) {
      const ack = await this.dispatchCommand(comando.modActionId, comando.params, evt);
      if (ack.ok) anyOk = true;
      this.emitCommandOutcome(ack, evt, {
        modActionId: comando.modActionId,
        accionId: accion.id,
        eventoId: evento.id,
        porque: evento.porque,
      });
    }
    return anyOk;
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
        message: `${describeLiveEvent(evt)} → ${ctx.modActionId}`,
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
