import { z } from "zod";
import { LiveEventType } from "./live-event.js";

/**
 * Regla de mapeo evento de TikTok → acción del mod (ADR 0001). **Legacy**:
 * reemplazada por el motor genérico de Acciones/Eventos (ADR 0004). El schema
 * se conserva únicamente para la migración de datos viejos.
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
