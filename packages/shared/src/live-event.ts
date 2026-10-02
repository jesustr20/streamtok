import { z } from "zod";

/**
 * Eventos normalizados que llegan del LIVE de TikTok (via tiktok-live-connector
 * en el sidecar). Estos NO son el protocolo del mod — son la entrada de la
 * capa de mapeo (ver mapping.ts) que decide qué mod-command disparar.
 */
export const LiveEventType = z.enum([
  "gift",
  "like",
  "comment",
  "follow",
  "share",
  "join",
  "subscribe",
  "emote",
]);
export type LiveEventTypeT = z.infer<typeof LiveEventType>;

/**
 * Escena de un LiveEvent `emote` (ADR 0005): distingue el emote de suscriptor
 * (`subscriber`, para `porque: emoteSuscriptor`) del sticker del Fan Club
 * (`fanClub`, para `porque: stickerFanClub`).
 */
export const LiveEventEmoteScene = z.enum(["subscriber", "fanClub"]);
export type LiveEventEmoteSceneT = z.infer<typeof LiveEventEmoteScene>;

export const LiveEventSchema = z.object({
  event: LiveEventType,
  username: z.string(), // @handle
  nickname: z.string().optional(), // display name real — es lo que va en nameTag
  giftName: z.string().optional(),
  giftId: z.number().optional(),
  coins: z.number().optional(), // valor total en monedas del regalo (repeatCount ya aplicado)
  repeatEnd: z.boolean().optional(), // gifts con streak: solo actuar cuando true
  text: z.string().optional(), // comentario / comando de chat
  timestamp: z.number(),
  // Metadata de viewer (issue #23 / ADR 0005). Opcionales a propósito: solo
  // presentes cuando la fuente (tiktok-live-connector) la reporta en positivo;
  // ausencia = desconocido = no dispara un `quien` de ese tipo.
  isFollower: z.boolean().optional(),
  isSubscriber: z.boolean().optional(),
  isModerator: z.boolean().optional(),
  // Evento `emote`: id del emote/sticker y su escena (suscriptor vs fan club).
  emoteId: z.string().optional(),
  emoteScene: LiveEventEmoteScene.optional(),
});
export type LiveEvent = z.infer<typeof LiveEventSchema>;

export const WsMessageSchema = z.object({
  channel: z.literal("live-event"),
  payload: LiveEventSchema,
});
export type WsMessage = z.infer<typeof WsMessageSchema>;
