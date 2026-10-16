import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { RoomMessageSchema, type RoomBattle, type RoomBattleSide, type RoomState, type RoomSupporter } from "@streamtok/shared";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Estado de la sala del LIVE (ADR 0013): espectadores y marcador de la batalla.
 * Los parsers son puros y tolerantes: TikTok no garantiza la forma de estos
 * mensajes, así que ante algo que no se entiende devuelven null y no cambian nada.
 *
 * Eventos: `state` (RoomState) cada vez que algo cambia.
 */

type Rec = Record<string, any>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

/** Número desde number o string numérico (TikTok manda int64 como texto); null si no es finito. */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Primera URL utilizable de una imagen de TikTok (`urlList`, `url_list` o `mUrls`). */
export function firstImageUrl(image: unknown): string | undefined {
  const img = rec(image);
  for (const list of [img.urlList, img.url_list, img.mUrls, img.urls]) {
    if (Array.isArray(list)) {
      const url = list.find((u): u is string => typeof u === "string" && u.length > 0);
      if (url) return url;
    }
  }
  return undefined;
}

/** Foto de perfil del usuario de un mensaje: prueba miniatura, mediana y grande. */
export function extractAvatarUrl(user: unknown): string | undefined {
  const u = rec(user);
  for (const key of ["avatarThumb", "avatar_thumb", "avatarMedium", "avatar_medium", "avatarLarge", "avatar_large", "profilePicture"]) {
    const url = firstImageUrl(u[key]);
    if (url) return url;
  }
  return undefined;
}

/** Espectadores desde `roomUser`: `viewerCount` (v1) o `totalUser` / `total` (v3). Null si no hay número. */
export function parseViewerCount(raw: unknown): number | null {
  const m = rec(raw);
  for (const v of [m.viewerCount, m.totalUser, m.total]) {
    const n = num(v);
    if (n !== null && n >= 0) return Math.round(n);
  }
  return null;
}

function supportersFrom(list: unknown): RoomSupporter[] {
  if (!Array.isArray(list)) return [];
  const out: RoomSupporter[] = [];
  for (const item of list) {
    const u = rec(item);
    const score = num(u.score) ?? num(u.diamondScore);
    const nickname = typeof u.nickname === "string" ? u.nickname : "";
    if (score === null || !nickname) continue;
    const avatarUrl = extractAvatarUrl(u) ?? firstImageUrl(u.avatarThumb);
    out.push({ nickname, score, ...(avatarUrl ? { avatarUrl } : {}) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Marcador desde `linkMicArmies`. Formas conocidas:
 *  - v3: `armies` = mapa idAnfitrión → { hostscore, anchorIdStr, userArmies[] }
 *  - v1: `battleItems[].battleGroups[]` con `points` y `users[]`
 * Devuelve null si no hay ningún lado con puntos legibles.
 */
export function parseBattleArmies(raw: unknown, now = Date.now()): RoomBattle | null {
  const m = rec(raw);
  const sides: RoomBattleSide[] = [];

  if (m.armies && typeof m.armies === "object" && !Array.isArray(m.armies)) {
    for (const [key, value] of Object.entries(m.armies as Rec)) {
      const a = rec(value);
      const points = num(a.hostscore) ?? num(a.hostScore);
      if (points === null) continue;
      const id = typeof a.anchorIdStr === "string" && a.anchorIdStr ? a.anchorIdStr : key;
      sides.push({ id, points, supporters: supportersFrom(a.userArmies) });
    }
  } else if (Array.isArray(m.battleItems)) {
    for (const item of m.battleItems) {
      const host = rec(item).hostUserId;
      const groups = rec(item).battleGroups;
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, i) => {
        const points = num(rec(group).points);
        if (points === null) return;
        sides.push({ id: `${host ?? "lado"}-${i + 1}`, points, supporters: supportersFrom(rec(group).users) });
      });
    }
  }

  if (sides.length === 0) return null;
  const battleId = typeof m.battleId === "string" && m.battleId ? m.battleId : undefined;
  return { ...(battleId ? { battleId } : {}), sides, updatedAt: now };
}

/** Nombres y fotos de los anfitriones desde `linkMicBattle` (`battleUsers[].battleGroup.user`); id → datos. */
export function parseBattleHosts(raw: unknown): Map<string, { name?: string; avatarUrl?: string }> {
  const out = new Map<string, { name?: string; avatarUrl?: string }>();
  const users = rec(raw).battleUsers;
  if (!Array.isArray(users)) return out;
  for (const item of users) {
    const user = rec(rec(rec(item).battleGroup).user);
    const id = user.userId ?? user.id ?? user.userIdStr;
    if (id === undefined || id === null || id === "") continue;
    const name = typeof user.nickname === "string" && user.nickname ? user.nickname : undefined;
    const avatarUrl = extractAvatarUrl(user);
    out.set(String(id), { ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) });
  }
  return out;
}

export class RoomStateEngine extends EventEmitter {
  private viewerCount: number | null = null;
  private battle: RoomBattle | null = null;
  private hosts = new Map<string, { name?: string; avatarUrl?: string }>();

  getState(): RoomState {
    return { viewerCount: this.viewerCount, battle: this.battle };
  }

  ingestRoomUser(raw: unknown) {
    const n = parseViewerCount(raw);
    if (n === null || n === this.viewerCount) return;
    this.viewerCount = n;
    this.emit("viewers", n);
    this.emit("state", this.getState());
  }

  ingestBattleHosts(raw: unknown) {
    for (const [id, info] of parseBattleHosts(raw)) this.hosts.set(id, info);
  }

  ingestBattleArmies(raw: unknown, now = Date.now()) {
    const battle = parseBattleArmies(raw, now);
    if (!battle) return;
    this.battle = {
      ...battle,
      sides: battle.sides.map((side) => ({ ...side, ...(this.hosts.get(side.id) ?? {}) })),
    };
    this.emit("state", this.getState());
  }

  /** Nueva sesión de LIVE: se olvidan espectadores y batalla. */
  reset() {
    this.viewerCount = null;
    this.battle = null;
    this.hosts.clear();
    this.emit("state", this.getState());
  }
}

/** Canal WS `room` (ADR 0013): reparte el estado de la sala; los clientes solo leen. */
export class RoomController {
  constructor(
    private server: StreamTokWsServer,
    private room: RoomStateEngine,
  ) {
    server.on("client-connected", (socket) => this.sendTo(socket));
    server.onChannel("room", (payload, socket) => {
      if (RoomMessageSchema.safeParse(payload).success && (payload as { kind?: string }).kind === "get-state") this.sendTo(socket);
    });
    room.on("state", () => server.broadcast("room", this.payload()));
  }

  private payload() {
    return { kind: "state" as const, room: this.room.getState(), serverNow: Date.now() };
  }

  private sendTo(socket: WebSocket) {
    this.server.sendTo(socket, "room", this.payload());
  }
}
