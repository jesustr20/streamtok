import { z } from "zod";
import { LiveEventType } from "./live-event.js";

/**
 * Regla de mapeo evento de TikTok → acción del mod. Contrato entre la UI del
 * desktop y el sidecar (que la persiste y la evalúa en `MappingEngine`).
 * El `MappingRule` de runtime del sidecar (mapping.ts) es este mismo tipo.
 */
export const MappingRuleSchema = z.object({
  id: z.string(),
  /** filtro simple sobre el LiveEvent */
  when: z.object({
    event: LiveEventType,
    giftId: z.number().optional(),
    minCoins: z.number().optional(),
    command: z.string().optional(), // para event:"comment" tipo "!zombie"
  }),
  /** acción del mod a disparar */
  action: z.string(),
  /** params fijos; los dinámicos (ej. cantidad = coins) se resuelven abajo */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  /** si viene, sobreescribe el valor de "coins" que se manda al mod */
  passCoinsAsParam: z.string().optional(),
});
export type MappingRule = z.infer<typeof MappingRuleSchema>;

/**
 * Canal WS `mapping-rules` (UI ↔ sidecar). Separado del protocolo del mod
 * (mod-hello/mod-command/mod-ack), que está reservado al mod.
 *
 *  - `set`     UI → sidecar: la lista completa de reglas a guardar.
 *  - `update`  sidecar → UI: la lista vigente (tras un set válido, o reenviada
 *              a clientes que se conectan tarde).
 *  - `error`   sidecar → UI: rechazo de un `set` inválido.
 */
export const MappingRulesMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), rules: z.array(MappingRuleSchema) }),
  z.object({ kind: z.literal("update"), rules: z.array(MappingRuleSchema) }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type MappingRulesMessage = z.infer<typeof MappingRulesMessageSchema>;
