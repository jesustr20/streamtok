import { z } from "zod";
import { LiveEventEmoteScene } from "./live-event.js";

/**
 * Catálogo de stickers y emotes "aprendido" (ADR 0018). Igual que el de regalos
 * (gift-catalog.ts), NO es parte del contrato del mod ni del LiveEvent: es un
 * dominio propio UI↔sidecar que se llena con los stickers/emotes que llegan por
 * eventos reales del LIVE (el mensaje de TikTok trae el id y la imagen).
 */

export const EmoteCatalogEntrySchema = z.object({
  /** `emoteId` tal cual viene en el mensaje de TikTok. */
  id: z.string().min(1),
  /** Origen: `subscriber` = emote de Super Fan / suscripción; `fanClub` = sticker del Club de fans. */
  scene: LiveEventEmoteScene,
  /** URL de la imagen (`emote.image.urlList[0]`). Puede faltar si el mensaje no la trajo. */
  imageUrl: z.string().optional(),
  /** Veces que ha llegado (para ordenar y para ver cuáles se usan). */
  count: z.number().int().positive().default(1),
  /** Código numérico crudo de `EmoteScene` que mandó TikTok (diagnóstico: ver ADR 0018). */
  sceneCode: z.number().int().optional(),
});
export type EmoteCatalogEntry = z.infer<typeof EmoteCatalogEntrySchema>;

/**
 * Canal WS `emote-catalog` (UI ↔ sidecar), patrón `get-state` como `gift-catalog`:
 *  - `get-state`  UI → sidecar: pedir el catálogo actual.
 *  - `state`      sidecar → UI: el catálogo vigente.
 */
export const EmoteCatalogMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), emotes: z.array(EmoteCatalogEntrySchema) }),
]);
export type EmoteCatalogMessage = z.infer<typeof EmoteCatalogMessageSchema>;
