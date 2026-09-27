import {
  COMMUNITY_RULE_KINDS,
  CommunityRuleSchema,
  CommunityRulesSchema,
  defaultCommunityRules,
  type CommunityRule,
  type CommunityRules,
  type ModHelloPayload,
} from "@streamtok/shared";
import { formatZodError, validateActionParams } from "./mapping-rules.js";

/**
 * Validación y normalización de reglas de comunidad (ADR 0003). Funciones puras
 * reutilizables; la persistencia y el manejo del canal WS viven en profiles.ts.
 */

export type CommunityValidationResult =
  | { ok: true; rules: CommunityRules }
  | { ok: false; errors: string[] };

/**
 * Completa un objeto parcial/incompleto de reglas de comunidad con los defaults
 * (4 slots, deshabilitados, sin acción, `everyNLikes: 1` en like). Se usa en la
 * migración de perfiles viejos (ADR 0003). Es tolerante por-slot: acepta objetos
 * a los que les falten slots (los completa) o slots inválidos (los resetea), y
 * descarta `everyNLikes` en cualquier slot que no sea `like`.
 */
export function normalizeCommunityRules(input: unknown): CommunityRules {
  const defaults = defaultCommunityRules();
  if (input === null || typeof input !== "object") return defaults;
  const obj = input as Record<string, unknown>;

  const out: CommunityRules = { ...defaults };
  for (const kind of COMMUNITY_RULE_KINDS) {
    const parsedSlot = CommunityRuleSchema.safeParse(obj[kind]);
    if (!parsedSlot.success) continue; // mantiene el default para ese slot
    const normalized: CommunityRule = {
      enabled: parsedSlot.data.enabled,
      action: parsedSlot.data.action,
      params: parsedSlot.data.params,
    };
    if (kind === "like") normalized.everyNLikes = parsedSlot.data.everyNLikes ?? 1;
    out[kind] = normalized;
  }
  return out;
}

/**
 * Valida un objeto de reglas de comunidad. Estructuralmente contra
 * `CommunityRulesSchema` y, si hay catálogo del mod conectado, semánticamente
 * contra las acciones/params publicados (solo para slots con acción asignada).
 */
export function validateCommunityRules(
  input: unknown,
  catalog: ModHelloPayload | null,
): CommunityValidationResult {
  const parsed = CommunityRulesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: [formatZodError(parsed.error)] };
  }
  const rules = normalizeCommunityRules(parsed.data);

  if (!catalog) return { ok: true, rules };

  const errors: string[] = [];
  for (const kind of COMMUNITY_RULE_KINDS) {
    const slot = rules[kind];
    if (!slot.action) continue;
    const action = catalog.actions.find((a) => a.id === slot.action);
    if (!action) {
      errors.push(
        `La regla de comunidad "${kind}" referencia la acción "${slot.action}", que no existe en el catálogo del mod.`,
      );
      continue;
    }
    for (const err of validateActionParams(action, slot.params)) {
      errors.push(`La regla de comunidad "${kind}" ${err}`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules };
}
