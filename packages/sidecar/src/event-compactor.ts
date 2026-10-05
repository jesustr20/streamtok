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
 *  3. Estados que se reenvían iguales (ranking de la sala, batalla, panel de
 *     regalos, meta): solo se guardan completos cuando cambian
 *     (`ref: "state-unchanged"` en los repetidos).
 *
 * Todo lo demás (comentarios, regalos, follows, tipos desconocidos…) se guarda
 * completo, y ante cualquier forma inesperada también: nunca se pierde un dato
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
const USER_VOLATILE = new Set(["followInfo"]);

export class EventCompactor {
  private readonly viewers = new Map<string, string>();
  private readonly states = new Map<string, string>();

  process(type: string, event: unknown): CompactResult {
    const slimmed = slim(event);
    const data = asRecord(asRecord(slimmed)?.data);
    if (!data) return { event: slimmed };

    if (VIEWER_TYPES.has(type)) {
      const user = asRecord(data.user);
      const userId = user?.id;
      if (user && typeof userId === "string" && userId !== "") {
        const sig = signature(user, USER_VOLATILE);
        if (this.viewers.get(userId) === sig) {
          return {
            ref: "viewer-seen",
            event: type === "WebcastLikeMessage" ? { userId, count: data.count, total: data.total } : { userId },
          };
        }
        this.viewers.set(userId, sig);
      }
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
