/**
 * Compactación de lo que graba la grabadora (event-recorder.ts).
 *
 * Los mensajes de TikTok LIVE pesan 12–49 KB cada uno, casi todo relleno que
 * se repite: listas de URLs de avatar firmadas (cambian en cada mensaje),
 * formatos de color/fuente del texto y datos del viewer repetidos en cada tap
 * o join. Aquí se reduce ese relleno SIN perder lo que sirve para analizar:
 *
 *  1. `slim`: quita los formatos de texto y deja una sola URL por lista de
 *     imágenes (se conserva `uri`, que identifica la imagen).
 *  2. Likes y joins: el primer mensaje de cada viewer (y cada vez que cambian
 *     sus insignias/nivel) va completo; los repetidos se guardan como una línea
 *     mínima (`ref: "viewer-seen"`) con el userId y, en likes, count y total.
 *  3. Comentarios, regalos y follows: el bloque `user` (insignias, nivel) se
 *     guarda completo la primera vez por viewer (y cuando cambia); después queda
 *     `{ id, nickname, seen: true }`. El mensaje en sí va siempre completo.
 *  4. Las copias del usuario que TikTok mete dentro del texto a mostrar
 *     (`userValue.user`) se reemplazan por `{ id, sameAsUser: true }` cuando son
 *     el mismo viewer que `data.user`.
 *  5. Estados que se reenvían iguales (ranking de la sala, batalla, panel de
 *     regalos, meta): solo se guardan completos cuando cambian
 *     (`ref: "state-unchanged"` en los repetidos).
 *
 * Todo lo demás (tipos desconocidos…) se guarda completo, y ante cualquier forma inesperada también: nunca se pierde un dato
 * por no entender un mensaje.
 */

export interface CompactResult {
  /** Presente solo si el mensaje se guardó en forma compacta. */
  ref?: "viewer-seen" | "state-unchanged";
  event: unknown;
}

const DROPPED_KEYS = new Set(["format", "defaultFormat"]);

/** Reduce el relleno de un mensaje ya serializable. No muta la entrada. */
export function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (DROPPED_KEYS.has(key)) continue;
    out[key] = key === "urlList" && Array.isArray(v) && v.length > 1 ? [v[0]] : slim(v);
  }
  return out;
}

/** Firma estable: ignora lo que cambia en cada mensaje sin ser un cambio real (URLs firmadas). */
function signature(value: unknown, omit: ReadonlySet<string> = new Set()): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "urlList" || omit.has(k)) continue;
      out[k] = walk(x);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

interface StateRule {
  /** Parte del mensaje cuyo cambio importa; `undefined` → forma inesperada. */
  key(data: Record<string, unknown>): unknown;
  /** Qué se conserva cuando el estado no cambió. */
  summary(data: Record<string, unknown>): unknown;
}

const STATE_RULES: Record<string, StateRule> = {
  WebcastRoomUserSeqMessage: {
    key: (d) =>
      Array.isArray(d.ranks)
        ? d.ranks.map((r) => [asRecord(asRecord(r)?.user)?.id, asRecord(r)?.score])
        : undefined,
    summary: (d) => ({ total: d.total, totalUser: d.totalUser, anonymous: d.anonymous }),
  },
  WebcastLinkMicArmies: { key: (d) => d.armies, summary: () => ({}) },
  WebcastGiftPanelUpdateMessage: { key: (d) => d.galleryData, summary: () => ({}) },
  WebcastGoalUpdateMessage: { key: (d) => d.goal, summary: () => ({}) },
};

const VIEWER_TYPES = new Set(["WebcastLikeMessage", "WebcastMemberMessage"]);
/** Mensajes completos cuyo bloque `user` se referencia si ya se guardó. */
const USER_BLOCK_TYPES = new Set(["WebcastChatMessage", "WebcastSocialMessage", "WebcastGiftMessage"]);
const USER_VOLATILE = new Set(["followInfo"]);

/** Reemplaza (in situ) las copias de `data.user` que viven dentro de `userValue`. */
function replaceEmbeddedUserCopies(node: unknown, userId: string): void {
  if (Array.isArray(node)) {
    for (const item of node) replaceEmbeddedUserCopies(item, userId);
    return;
  }
  const rec = asRecord(node);
  if (!rec) return;
  const userValue = asRecord(rec.userValue);
  if (userValue && asRecord(userValue.user)?.id === userId) {
    userValue.user = { id: userId, sameAsUser: true };
  }
  for (const v of Object.values(rec)) replaceEmbeddedUserCopies(v, userId);
}

export class EventCompactor {
  private readonly viewers = new Map<string, string>();
  private readonly states = new Map<string, string>();

  /** true si este viewer ya se guardó con el mismo usuario en este tipo de mensaje; si no, lo registra. */
  private seenSameViewer(type: string, userId: string, user: Record<string, unknown>): boolean {
    const key = `${type}|${userId}`;
    const sig = signature(user, USER_VOLATILE);
    if (this.viewers.get(key) === sig) return true;
    this.viewers.set(key, sig);
    return false;
  }

  process(type: string, event: unknown): CompactResult {
    const slimmed = slim(event);
    const data = asRecord(asRecord(slimmed)?.data);
    if (!data) return { event: slimmed };

    const user = asRecord(data.user);
    const userId = typeof user?.id === "string" && user.id !== "" ? user.id : null;
    if (userId) replaceEmbeddedUserCopies(data, userId);

    if (VIEWER_TYPES.has(type)) {
      if (user && userId && this.seenSameViewer(type, userId, user)) {
        return {
          ref: "viewer-seen",
          event: type === "WebcastLikeMessage" ? { userId, count: data.count, total: data.total } : { userId },
        };
      }
      return { event: slimmed };
    }

    if (USER_BLOCK_TYPES.has(type) && user && userId && this.seenSameViewer(type, userId, user)) {
      data.user = { id: userId, nickname: user.nickname, seen: true };
      return { event: slimmed };
    }

    const rule = STATE_RULES[type];
    if (rule) {
      const key = rule.key(data);
      if (key !== undefined) {
        const sig = signature(key);
        if (this.states.get(type) === sig) return { ref: "state-unchanged", event: rule.summary(data) };
        this.states.set(type, sig);
      }
    }
    return { event: slimmed };
  }
}
