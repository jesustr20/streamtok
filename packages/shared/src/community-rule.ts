import { z } from "zod";

/**
 * Reglas de comunidad (ADR 0003). **Legacy** — ADR 0003 fue reemplazada por el
 * motor genérico de Acciones/Eventos (ADR 0004): los 4 slots de comunidad son
 * ahora Eventos normales (`seguir`/`compartir`/`suscribirse`/`likes`). Los
 * schemas se conservan únicamente para la migración de datos viejos.
 */

/** Orden canónico de las 4 filas (para UI y migración). */
export const COMMUNITY_RULE_KINDS = ["follow", "share", "superfan", "like"] as const;
export type CommunityRuleKind = (typeof COMMUNITY_RULE_KINDS)[number];

export const CommunityRuleKindSchema = z.enum(COMMUNITY_RULE_KINDS);

/** Configuración de un slot. `action` vacío = sin acción asignada. */
export const CommunityRuleSchema = z.object({
  enabled: z.boolean(),
  action: z.string(),
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  /** Solo tiene sentido en el slot "like": dispara cada N likes. */
  everyNLikes: z.number().int().positive().optional(),
});
export type CommunityRule = z.infer<typeof CommunityRuleSchema>;

/** Objeto fijo de 4 slots. La forma (no un array) hace explícito "siempre 4,
 * nunca se crean ni se borran". */
export const CommunityRulesSchema = z.object({
  follow: CommunityRuleSchema,
  share: CommunityRuleSchema,
  superfan: CommunityRuleSchema,
  like: CommunityRuleSchema,
});
export type CommunityRules = z.infer<typeof CommunityRulesSchema>;

/** Default de un slot: deshabilitado y sin acción. */
export function defaultCommunityRule(): CommunityRule {
  return { enabled: false, action: "", params: {} };
}

/** Default de las 4 filas completas (used para migrar perfiles sin el campo). */
export function defaultCommunityRules(): CommunityRules {
  return {
    follow: defaultCommunityRule(),
    share: defaultCommunityRule(),
    superfan: defaultCommunityRule(),
    like: { ...defaultCommunityRule(), everyNLikes: 1 },
  };
}
