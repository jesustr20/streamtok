import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ModAction,
  type ModActionParam,
} from "@streamtok/shared";

/**
 * Helpers de validación reutilizables (ADR 0001 → ADR 0004) + ruta de
 * app-data. La validación de listas vivía acá en `validateRules`/`validateCommunityRules`;
 * con el motor genérico eso se movió a `acciones-eventos.ts`. Acá quedan las
 * funciones puras compartidas.
 */

export function formatZodError(err: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  const issues = err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "raíz"}: ${i.message}`);
  return `Formato inválido: ${issues.join("; ")}`;
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
 * Valida los `params` de un comando contra la definición de su acción en el
 * catálogo del mod-hello. Devuelve los errores (sin prefijo) para que el
 * llamador los contextualice. Reusada por `validateAcciones` (ADR 0004).
 */
export function validateActionParams(
  action: ModAction,
  params: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const paramsByName = new Map(action.params.map((p) => [p.name, p]));
  for (const [key, value] of Object.entries(params)) {
    const param = paramsByName.get(key);
    if (!param) {
      errors.push(
        `usa el parámetro "${key}", que la acción "${action.id}" no define.`,
      );
      continue;
    }
    if (!paramValueMatches(param, value)) {
      errors.push(
        `da al parámetro "${key}" un valor incompatible con su tipo (${param.type}).`,
      );
    }
  }
  return errors;
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
