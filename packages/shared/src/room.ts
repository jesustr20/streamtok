import { z } from "zod";

/**
 * Estado de la sala del LIVE (ADR 0013): espectadores y marcador de la batalla de
 * TikTok. No son `LiveEvent` (no los hace un usuario); viajan por el canal WS `room`.
 */

export const RoomSupporterSchema = z.object({
  nickname: z.string(),
  avatarUrl: z.string().optional(),
  score: z.number(),
});
export type RoomSupporter = z.infer<typeof RoomSupporterSchema>;

export const RoomBattleSideSchema = z.object({
  /** id del anfitrión de ese lado (tal cual lo manda TikTok) */
  id: z.string(),
  /** nombre y foto del anfitrión, si el LIVE los trajo */
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  points: z.number(),
  /** quienes más aportaron a ese lado, de mayor a menor */
  supporters: z.array(RoomSupporterSchema).default([]),
});
export type RoomBattleSide = z.infer<typeof RoomBattleSideSchema>;

export const RoomBattleSchema = z.object({
  battleId: z.string().optional(),
  sides: z.array(RoomBattleSideSchema),
  /** epoch ms de la última actualización recibida */
  updatedAt: z.number(),
});
export type RoomBattle = z.infer<typeof RoomBattleSchema>;

export const RoomStateSchema = z.object({
  /** espectadores ahora mismo; null = aún no se sabe */
  viewerCount: z.number().int().nonnegative().nullable(),
  /** último marcador de batalla visto; null = ninguna batalla en esta sesión */
  battle: RoomBattleSchema.nullable(),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

/** Canal WS `room`: `get-state` (cliente → sidecar) y `state` (sidecar → todos, en cada cambio). */
export const RoomMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), room: RoomStateSchema, serverNow: z.number() }),
]);
export type RoomMessage = z.infer<typeof RoomMessageSchema>;
