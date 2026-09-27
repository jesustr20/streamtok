import { homedir } from "node:os";
import { join } from "node:path";
import {
  MappingRuleSchema,
  type ModActionParam,
  type ModHelloPayload,
  type MappingRule,
} from "@streamtok/shared";

/**
 * Validación de reglas de mapeo (ver ADR 0001) + ruta de app-data. La
 * persistencia/perfiles y el manejo de canales WS viven en profiles.ts
 * (ADR 0002); acá quedan las funciones puras reutilizables.
 */

export type ValidationResult =
  | { ok: true; rules: MappingRule[] }
  | { ok: false; errors: string[] };

function formatZodError(err: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  const issues = err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "raíz"}: ${i.message}`);
  return `Formato de reglas inválido: ${issues.join("; ")}`;
}

function paramValueMatches(param: ModActionParam, value: unknown): boolean {
  switch (param.type) {
    case "int":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "enum":
      if (typeof value !== "string") return false;
      if (param.options && param.options.length > 0 && !param.options.includes(value)) {
        return false;
      }
      return true;
  }
}

/**
 * Valida una lista de reglas. Estructuralmente contra `MappingRuleSchema` y,
 * si hay catálogo del mod conectado, semánticamente contra las acciones/params
 * que el mod publicó. Devuelve los errores (string[]) o las reglas listas.
 */
export function validateRules(
  input: unknown,
  catalog: ModHelloPayload | null,
): ValidationResult {
  const parsed = MappingRuleSchema.array().safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: [formatZodError(parsed.error)] };
  }
  const rules = parsed.data;

  // Sin mod conectado no podemos validar contra el catálogo; se valida solo
  // la forma y se deja pasar (el usuario puede preconfigurar antes de que el
  // mod arranque).
  if (!catalog) return { ok: true, rules };

  const errors: string[] = [];
  for (const rule of rules) {
    const action = catalog.actions.find((a) => a.id === rule.action);
    if (!action) {
      errors.push(
        `La regla "${rule.id}" referencia la acción "${rule.action}", que no existe en el catálogo del mod.`,
      );
      continue;
    }

    const paramsByName = new Map(action.params.map((p) => [p.name, p]));
    for (const [key, value] of Object.entries(rule.params)) {
      const param = paramsByName.get(key);
      if (!param) {
        errors.push(
          `La regla "${rule.id}" usa el parámetro "${key}", que la acción "${action.id}" no define.`,
        );
        continue;
      }
      if (!paramValueMatches(param, value)) {
        errors.push(
          `La regla "${rule.id}" da al parámetro "${key}" un valor incompatible con su tipo (${param.type}).`,
        );
      }
    }

    if (rule.passCoinsAsParam && !paramsByName.has(rule.passCoinsAsParam)) {
      errors.push(
        `La regla "${rule.id}" pasa coins al parámetro "${rule.passCoinsAsParam}", que la acción "${action.id}" no define.`,
      );
    }

    if (rule.when.command !== undefined && rule.when.event !== "comment") {
      errors.push(
        `La regla "${rule.id}" define "command" pero su evento es "${rule.when.event}" (solo aplica a "comment").`,
      );
    }
    if (
      (rule.when.giftId !== undefined || rule.when.minCoins !== undefined) &&
      rule.when.event !== "gift"
    ) {
      errors.push(
        `La regla "${rule.id}" define giftId/minCoins pero su evento es "${rule.when.event}" (solo aplica a "gift").`,
      );
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules };
}

export function appDataDir(): string {
  const override = process.env.STREAMTOK_CONFIG_DIR;
  if (override) return override;
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "StreamTok");
    case "darwin":
      return join(home, "Library", "Application Support", "StreamTok");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "streamtok");
  }
}

