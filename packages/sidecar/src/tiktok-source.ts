import { LevelTracker } from "./level-tracker.js";
import { EventEmitter } from "node:events";
import {
  ControlEvent,
  EmoteScene,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";
import { LiveEventSchema, type GiftCatalogEntry, type LiveEvent } from "@streamtok/shared";
import type { EventRecorder } from "./event-recorder.js";

/**
 * tiktok-live-connector@2.5.0 declara `TikTokLiveConnection` como un
 * TypedEventEmitter, pero sus .d.ts no propagan los métodos de EventEmitter
 * (`.on`) al consumidor (el tipo base no se resuelve). En runtime SÍ es un
 * EventEmitter. Tipamos el mínimo que usamos para poder suscribirnos sin
 * pelearnos con ese tipo roto.
 */
type TiktokConnectionHandle = {
  connect(roomId?: string): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string | symbol, listener: (...args: any[]) => void): unknown;
};

/**
 * Conecta con el LIVE de TikTok vía tiktok-live-connector y normaliza sus
 * eventos (chat, gift, like, follow, share, member, subscribe) a `LiveEvent`
 * (packages/shared/src/live-event.ts). Esto es upstream del motor de Acciones
 * y Eventos (acciones-eventos-engine.ts): no inventa canales WS ni toca el
 * protocolo del mod.
 */

/** Nombres de evento tal cual los emite tiktok-live-connector (v2.5.0). */
export type TiktokEventKind =
  | "chat"
  | "gift"
  | "like"
  | "member"
  | "follow"
  | "share"
  | "subNotify"
  | "emote";

export interface TiktokLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  details?: unknown;
}

type RawRecord = Record<string, any>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" ? (value as RawRecord) : {};
}

/**
 * Extrae identidad del viewer. `username` es el `@handle` (displayId de
 * TikTok) y `nickname` el display name real — que es lo que el motor usa
 * como `nameTag`. Si no hay handle, devuelve `username: null` (evento sin
 * remitente identificable → se descarta).
 */
function extractUserIdentity(raw: RawRecord): { username: string | null; nickname?: string } {
  const user = raw.user as { displayId?: unknown; nickname?: unknown } | undefined;
  const displayId = typeof user?.displayId === "string" ? user.displayId : "";
  const handle = displayId.startsWith("@") ? displayId.slice(1) : displayId;
  const nickname =
    typeof user?.nickname === "string" && user.nickname.length > 0 ? user.nickname : undefined;
  if (!handle) return { username: null, nickname };
  return { username: `@${handle}`, nickname };
}

/**
 * Metadata de viewer que tiktok-live-connector reporta en el campo `user` de la
 * mayoría de eventos (chat/gift/like/member/social/subNotify/emote). Solo se
 * incluye cada bandera cuando la fuente la afirma explícitamente (`true`);
 * ausencia = desconocido = ese `quien` no coincidirá. Ver ADR 0005.
 */
/**
 * Niveles del usuario desde `user.badgeList[]` (ADR 0007). Cada insignia lleva
 * un `sceneType`: 8 = nivel de usuario/donador, 10 = nivel del Fan Club,
 * 6 = ranking de donantes de la sala ("No. 3"). El nivel va en
 * `privilegeLogExtra.level` (string) o, si falta, en `combine.str`. Nivel 0 o
 * texto sin número = desconocido (no se incluye).
 */
export function extractLevels(raw: unknown): {
  userLevel?: number;
  fanLevel?: number;
  topGifterRank?: number;
} {
  const list = asRecord(asRecord(raw).user).badgeList;
  const out: { userLevel?: number; fanLevel?: number; topGifterRank?: number } = {};
  if (!Array.isArray(list)) return out;
  const toPositiveInt = (value: unknown): number | undefined => {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  for (const item of list) {
    const badge = asRecord(item);
    const combine = asRecord(badge.combine);
    const scene = Number(badge.sceneType);
    if (scene === 8 || scene === 10) {
      const level = toPositiveInt(asRecord(badge.privilegeLogExtra).level) ?? toPositiveInt(combine.str);
      if (level === undefined) continue;
      if (scene === 8) out.userLevel = level;
      else out.fanLevel = level;
    } else if (scene === 6) {
      const text = asRecord(combine.text).defaultPattern;
      const match = typeof text === "string" ? /(\d+)/.exec(text) : null;
      const rank = match ? toPositiveInt(match[1]) : undefined;
      if (rank !== undefined) out.topGifterRank = rank;
    }
  }
  return out;
}

function extractUserFlags(raw: RawRecord): {
  isFollower?: boolean;
  isSubscriber?: boolean;
  isModerator?: boolean;
  userLevel?: number;
  fanLevel?: number;
  topGifterRank?: number;
} {
  const user = asRecord(raw.user);
  const userAttr = asRecord(user.userAttr);
  // `userIdentity` (en el mensaje, no en `user`) es la señal fiable respecto al
  // streamer: en grabaciones reales `user.isFollower` llega en false aunque el
  // usuario sí lo siga.
  const identity = asRecord(raw.userIdentity);
  const flags: ReturnType<typeof extractUserFlags> = { ...extractLevels(raw) };
  if (user.isFollower === true || identity.isFollowerOfAnchor === true) flags.isFollower = true;
  if (user.isSubscribe === true || identity.isSubscriberOfAnchor === true) flags.isSubscriber = true;
  if (userAttr.isAdmin === true || userAttr.isSuperAdmin === true) flags.isModerator = true;
  return flags;
}

/** Valida el candidato con LiveEventSchema; devuelve null si no calza. */
function finalize(candidate: Record<string, unknown>): LiveEvent | null {
  const parsed = LiveEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function mapChat(raw: RawRecord): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;
  const text = typeof raw.content === "string" ? raw.content.trim() : "";
  if (!text) return null;
  return finalize({
    event: "comment",
    username,
    nickname,
    text,
    timestamp: Date.now(),
    ...extractUserFlags(raw),
  });
}

function mapGift(raw: RawRecord): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;

  // Streaks de regalo: tiktok-live-connector emite eventos intermedios
  // (repeatEnd: 0) y un evento final (repeatEnd: 1). Normalizamos `repeatEnd`
  // tal cual para que el motor decida (repetir con combo o esperar el cierre).
  const repeatEnd =
    raw.repeatEnd === 1 || raw.repeatEnd === true
      ? true
      : raw.repeatEnd === 0 || raw.repeatEnd === false
        ? false
        : undefined;

  let giftId: number | undefined;
  if (raw.giftId !== undefined && raw.giftId !== null && raw.giftId !== "") {
    const n = Number(raw.giftId);
    if (!Number.isFinite(n)) return null;
    giftId = n;
  }

  const giftName =
    typeof raw.gift?.name === "string" && raw.gift.name.length > 0 ? raw.gift.name : undefined;

  let coins: number | undefined;
  const diamondCount = raw.gift?.diamondCount;
  if (typeof diamondCount === "number" && Number.isFinite(diamondCount)) {
    const count = typeof raw.repeatCount === "number" && raw.repeatCount > 0 ? raw.repeatCount : 1;
    coins = diamondCount * count;
  }

  return finalize({
    event: "gift",
    username,
    nickname,
    giftId,
    giftName,
    coins,
    repeatEnd,
    timestamp: Date.now(),
    ...extractUserFlags(raw),
  });
}

/** Elige la URL de imagen del regalo: `gift.image.urlList[0]`, con fallback a
 * `gift.icon.urlList[0]` si `image` viniera vacío (issue #35). */
function pickGiftImageUrl(gift: RawRecord): string | undefined {
  const firstUrl = (list: unknown): string | undefined =>
    Array.isArray(list) ? list.find((u): u is string => typeof u === "string" && u.length > 0) : undefined;
  const image = asRecord(gift.image);
  const icon = asRecord(gift.icon);
  return firstUrl(image.urlList) ?? firstUrl(icon.urlList);
}

/** Extrae del evento crudo de regalo la entrada del catálogo (id, nombre,
 * imagen, costo). Devuelve null si falta algún campo obligatorio. */
export function extractGiftCatalogEntry(raw: unknown): GiftCatalogEntry | null {
  const msg = asRecord(raw);
  const gift = asRecord(msg.gift);
  const id = typeof gift.id === "string" && gift.id.length > 0 ? gift.id : undefined;
  const name = typeof gift.name === "string" && gift.name.length > 0 ? gift.name : undefined;
  const imageUrl = pickGiftImageUrl(gift);
  const cost =
    typeof gift.diamondCount === "number" && Number.isFinite(gift.diamondCount)
      ? gift.diamondCount
      : undefined;
  if (!id || !name || !imageUrl || cost === undefined) return null;
  return { id, name, imageUrl, cost };
}

export interface HostProfile {
  nickname?: string;
  avatarUrl?: string;
}

/**
 * Saca nombre y foto del dueño del LIVE desde `roomInfo` (respuesta cruda de
 * TikTok). La forma exacta no está garantizada, así que se prueban las
 * variantes conocidas (snake_case / camelCase, con o sin `data`) y se devuelve
 * null si no hay nada utilizable.
 */
export function extractHostProfile(roomInfo: unknown): HostProfile | null {
  const root = asRecord(roomInfo);
  const owner = asRecord(asRecord(root.data).owner);
  const fallbackOwner = asRecord(root.owner);
  const o = Object.keys(owner).length > 0 ? owner : fallbackOwner;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const nickname = str(o.nickname) ?? str(o.display_id) ?? str(o.displayId);
  let avatarUrl: string | undefined;
  for (const key of ["avatar_thumb", "avatarThumb", "avatar_medium", "avatarMedium", "avatar_large", "avatarLarge"]) {
    const img = asRecord(o[key]);
    const list = img.url_list ?? img.urlList;
    avatarUrl = Array.isArray(list) ? list.find((u): u is string => typeof u === "string" && u.length > 0) : undefined;
    if (avatarUrl) break;
  }
  if (!nickname && !avatarUrl) return null;
  return { ...(nickname ? { nickname } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

function mapUserEvent(
  event: "like" | "join" | "follow" | "share" | "subscribe",
  raw: RawRecord,
): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;
  const likeCount = event === "like" ? extractLikeCount(raw) : undefined;
  return finalize({
    event,
    username,
    nickname,
    timestamp: Date.now(),
    ...(likeCount !== undefined ? { likeCount } : {}),
    ...extractUserFlags(raw),
  });
}

/** Taps que trae un mensaje de like: el campo real es `count` (en algunas
 * versiones del conector, `likeCount`). Si no hay un entero positivo, se omite
 * y el motor cuenta 1. */
function extractLikeCount(raw: RawRecord): number | undefined {
  for (const v of [raw.count, raw.likeCount]) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Mapea el evento `emote` (WebcastEmoteChatMessage). TikTok usa el mismo
 * mensaje tanto para el emote de suscriptor como para el sticker del Fan Club,
 * distinguiéndolos por `EmoteScene`. Solo tomamos el primer emote con `emoteId`.
 */
function mapEmote(raw: RawRecord): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;

  const emoteList = Array.isArray(raw.emoteList) ? raw.emoteList : [];
  const emote = emoteList.find((entry) => {
    const id = asRecord(entry).emoteId;
    return typeof id === "string" && id.length > 0;
  });
  if (!emote) return null;

  const id = emote.emoteId as string;
  const scene = emote.emoteScene === EmoteScene.FANS_CLUB ? "fanClub" : "subscriber";

  return finalize({
    event: "emote",
    username,
    nickname,
    emoteId: id,
    emoteScene: scene,
    timestamp: Date.now(),
    ...extractUserFlags(raw),
  });
}

/**
 * Mapea un evento crudo de tiktok-live-connector a un `LiveEvent` validado.
 * Devuelve `null` (descarta) si el evento es un streak intermedio de regalo o
 * si no se puede normalizar (remitente faltante / malformado). Es puro y
 * testeable sin abrir una conexión real.
 */
export function mapTiktokEvent(kind: TiktokEventKind, raw: unknown): LiveEvent | null {
  const msg = asRecord(raw);
  switch (kind) {
    case "chat":
      return mapChat(msg);
    case "gift":
      return mapGift(msg);
    case "like":
      return mapUserEvent("like", msg);
    case "member":
      return mapUserEvent("join", msg);
    case "follow":
      return mapUserEvent("follow", msg);
    case "share":
      return mapUserEvent("share", msg);
    case "subNotify":
      return mapUserEvent("subscribe", msg);
    case "emote":
      return mapEmote(msg);
    default:
      return null;
  }
}

export class TikTokLiveSource extends EventEmitter {
  private connection: TikTokLiveConnection | null = null;
  private readonly levels = new LevelTracker();

  /** `recorder` (opcional) graba cada mensaje crudo del LIVE para análisis
   * posterior (ver event-recorder.ts); no afecta al mapeo ni al motor. */
  constructor(
    private readonly username: string,
    private readonly recorder?: Pick<EventRecorder, "record">,
  ) {
    super();
  }

  /** Graba un mensaje decodificado tal cual llegó (sin normalizar). Expuesto
   * para poder probarlo sin abrir una conexión real. */
  recordRaw(type: string, event: unknown): void {
    this.recorder?.record(type, event);
  }

  /** Normaliza y re-emite un evento crudo. Expuesto para poder probar el
   * mapeo + logging sin abrir una conexión real. */
  ingest(kind: TiktokEventKind, raw: unknown): LiveEvent | null {
    // Aprende el catálogo de regalos incrementalmente (issue #35): si el evento
    // crudo trae id/nombre/imagen/costo, se emite aparte para el GiftCatalog.
    if (kind === "gift") {
      const entry = extractGiftCatalogEntry(raw);
      if (entry) this.emit("giftCatalogEntry", entry);
    }
    const evt = mapTiktokEvent(kind, raw);
    if (evt) {
      this.emit("event", evt);
    } else {
      this.emit("log", {
        level: "warn",
        message: `Evento "${kind}" de TikTok descartado (sin remitente, streak intermedio o malformado)`,
      });
    }
    this.detectLevelUps(raw);
    return evt;
  }

  /** Subidas de nivel (ADR 0007): se compara contra el último nivel visto del
   * usuario, aunque el mensaje en sí se haya descartado (ej. regalo en combo). */
  private detectLevelUps(raw: unknown): void {
    const msg = asRecord(raw);
    const { username, nickname } = extractUserIdentity(msg);
    if (!username) return;
    const levels = extractLevels(msg);
    for (const change of this.levels.observe(username, levels)) {
      const evt = finalize({
        event: change.kind,
        username,
        nickname,
        timestamp: Date.now(),
        previousLevel: change.previousLevel,
        newLevel: change.newLevel,
        ...levels,
      });
      if (evt) this.emit("event", evt);
    }
  }

  async start(): Promise<void> {
    this.levels.reset();
    const connection = new TikTokLiveConnection(this.username, {});
    this.connection = connection;
    const events = connection as unknown as TiktokConnectionHandle;

    events.on(WebcastEvent.CHAT, (data) => this.ingest("chat", data));
    events.on(WebcastEvent.GIFT, (data) => this.ingest("gift", data));
    events.on(WebcastEvent.LIKE, (data) => this.ingest("like", data));
    events.on(WebcastEvent.MEMBER, (data) => this.ingest("member", data));
    events.on(WebcastEvent.FOLLOW, (data) => this.ingest("follow", data));
    events.on(WebcastEvent.SHARE, (data) => this.ingest("share", data));
    events.on(WebcastEvent.SUB_NOTIFY, (data) => this.ingest("subNotify", data));
    events.on(WebcastEvent.EMOTE, (data) => this.ingest("emote", data));

    // Todos los mensajes decodificados (también los que la app aún no mapea:
    // niveles, batallas, ranking…), solo si hay grabadora activa.
    if (this.recorder) {
      events.on(ControlEvent.DECODED_DATA, (type: string, event: unknown) => this.recordRaw(type, event));
    }

    events.on(ControlEvent.ERROR, (err) => {
      this.emit("log", {
        level: "error",
        message: "Error en la conexión de TikTok LIVE",
        details: err,
      });
    });
    events.on(ControlEvent.DISCONNECTED, ({ code, reason }) => {
      this.emit("log", {
        level: "warn",
        message: `Desconectado del LIVE de TikTok (${code}${reason ? `: ${reason}` : ""})`,
      });
      // Avisa a quien controle la conexión (UI) de que el LIVE se cortó.
      this.emit("disconnected", code);
    });

    await connection.connect();
    this.emit("connected");
    this.emit("log", { level: "info", message: `Conectado al LIVE de TikTok (@${this.username})` });
  }

  /** Perfil del dueño del LIVE según `roomInfo`; null si no está disponible. */
  getHostProfile(): HostProfile | null {
    const info = (this.connection as unknown as { roomInfo?: unknown } | null)?.roomInfo;
    const profile = extractHostProfile(info);
    if (!profile) {
      const keys = Object.keys(asRecord(info));
      const dataKeys = Object.keys(asRecord(asRecord(info).data));
      this.emit("log", {
        level: "warn",
        message: `No se encontró el perfil del dueño en roomInfo (claves: ${keys.join(",") || "ninguna"}; data: ${dataKeys.join(",") || "ninguna"})`,
      });
    }
    return profile;
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      await connection.disconnect().catch(() => {});
    }
  }
}
