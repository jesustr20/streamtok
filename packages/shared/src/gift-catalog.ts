import { z } from "zod";

/**
 * Catálogo de regalos "aprendido" (issue #35). NO forma parte del contrato
 * externo del mod (mod-protocol.ts) ni del LiveEvent (live-event.ts): es un
 * dominio propio UI↔sidecar. Se llena de forma incremental con los regalos
 * que llegan por eventos reales del LIVE (ver gift-catalog.ts del sidecar y
 * `extractGiftCatalogEntry` en tiktok-source.ts).
 */

export const GiftCatalogEntrySchema = z.object({
  /** id del regalo tal cual viene en `gift.id` del evento crudo (ej. "5487").
   * Opcional: los regalos sembrados desde el catálogo estático solo tienen
   * nombre hasta que un evento real confirme su id. */
  id: z.string().optional(),
  /** display name del regalo (ej. "Finger Heart"). */
  name: z.string(),
  /** URL principal de la imagen (gift.image.urlList[0]; fallback gift.icon.urlList[0]). */
  imageUrl: z.string(),
  /** costo base del regalo en monedas (gift.diamondCount). */
  cost: z.number(),
});
export type GiftCatalogEntry = z.infer<typeof GiftCatalogEntrySchema>;

/**
 * Canal WS `gift-catalog` (UI ↔ sidecar), mismo patrón `get-state` que
 * `profiles`:
 *  - `get-state`  UI → sidecar: pedir el catálogo actual.
 *  - `state`      sidecar → UI: el catálogo vigente (broadcast en cada regalo
 *                 nuevo aprendido, a clientes que conectan tarde y en
 *                 respuesta a `get-state`).
 */
export const GiftCatalogMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), gifts: z.array(GiftCatalogEntrySchema) }),
]);
export type GiftCatalogMessage = z.infer<typeof GiftCatalogMessageSchema>;
