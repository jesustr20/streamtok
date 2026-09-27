import { EventEmitter } from "node:events";
import {
  ControlEvent,
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";
import { LiveEventSchema, type LiveEvent } from "@streamtok/shared";

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
  | "subNotify";

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
  return finalize({ event: "comment", username, nickname, text, timestamp: Date.now() });
}

function mapGift(raw: RawRecord): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;

  // Streaks de regalo: tiktok-live-connector emite eventos intermedios
  // (repeatEnd: 0) y un evento final (repeatEnd: 1). Solo el final dispara
  // handleEvent — mismo convenio que el motor con `repeatEnd`.
  const repeatEnd = raw.repeatEnd === 1 || raw.repeatEnd === true;
  const giftType = raw.gift?.type;
  if (giftType === 1 && !repeatEnd) return null;

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
    repeatEnd: true,
    timestamp: Date.now(),
  });
}

function mapUserEvent(
  event: "like" | "join" | "follow" | "share" | "subscribe",
  raw: RawRecord,
): LiveEvent | null {
  const { username, nickname } = extractUserIdentity(raw);
  if (!username) return null;
  return finalize({ event, username, nickname, timestamp: Date.now() });
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
    default:
      return null;
  }
}

export class TikTokLiveSource extends EventEmitter {
  private connection: TikTokLiveConnection | null = null;

  constructor(private readonly username: string) {
    super();
  }

  /** Normaliza y re-emite un evento crudo. Expuesto para poder probar el
   * mapeo + logging sin abrir una conexión real. */
  ingest(kind: TiktokEventKind, raw: unknown): LiveEvent | null {
    const evt = mapTiktokEvent(kind, raw);
    if (evt) {
      this.emit("event", evt);
    } else {
      this.emit("log", {
        level: "warn",
        message: `Evento "${kind}" de TikTok descartado (sin remitente, streak intermedio o malformado)`,
      });
    }
    return evt;
  }

  async start(): Promise<void> {
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
    });

    await connection.connect();
    this.emit("log", { level: "info", message: `Conectado al LIVE de TikTok (@${this.username})` });
  }

  async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      await connection.disconnect().catch(() => {});
    }
  }
}
