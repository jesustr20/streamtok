import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { WebSocket } from "ws";
import {
  MappingRuleSchema,
  MappingRulesMessageSchema,
  type ModActionParam,
  type ModHelloPayload,
  type MappingRule,
} from "@streamtok/shared";
import type { MappingEngine } from "./mapping.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Persistencia + validación de las reglas de mapeo (ver ADR 0001). El sidecar
 * es dueño del archivo (JSON en app-data) y de las reglas en runtime
 * (MappingEngine); la UI las edita por el canal WS `mapping-rules`.
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

export function defaultRulesFilePath(): string {
  return join(appDataDir(), "mapping-rules.json");
}

export class MappingRulesStore {
  constructor(
    private filePath: string,
    private onWarn?: (message: string) => void,
  ) {}

  /** Carga las reglas persistidas. Archivo ausente/vacío → []. Corrupto o
   * con forma inválida → [] + warning (no lanza). */
  load(): MappingRule[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      }
      return [];
    }

    if (raw.trim() === "") return [];

    try {
      const data: unknown = JSON.parse(raw);
      const parsed = MappingRuleSchema.array().safeParse(data);
      if (!parsed.success) {
        this.onWarn?.(`Reglas persistidas con formato inválido en ${this.filePath}; se ignoran.`);
        return [];
      }
      return parsed.data;
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.filePath}; se ignora: ${(err as Error).message}`);
      return [];
    }
  }

  async save(rules: MappingRule[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(rules, null, 2), "utf8");
  }
}

export class MappingRulesController extends EventEmitter {
  constructor(
    private server: StreamTokWsServer,
    private store: MappingRulesStore,
    private engine: MappingEngine,
    private getCatalog: () => ModHelloPayload | null,
  ) {
    super();

    const rules = this.store.load();
    this.engine.setRules(rules);
    this.emit("log", { level: "info", message: `Cargadas ${rules.length} reglas de mapeo` });

    this.server.onChannel("mapping-rules", (payload, socket) => {
      this.handleSet(payload, socket);
    });

    this.server.on("client-connected", (socket) => {
      this.server.sendTo(socket, "mapping-rules", {
        kind: "update",
        rules: this.engine.getRules(),
      });
    });
  }

  private handleSet(payload: unknown, socket: WebSocket) {
    const parsed = MappingRulesMessageSchema.safeParse(payload);
    // Solo aceptamos "set" (UI→sidecar). "update"/"error" los emite el propio
    // sidecar; mensajes que no calzan se ignoran.
    if (!parsed.success || parsed.data.kind !== "set") return;

    const result = validateRules(parsed.data.rules, this.getCatalog());
    if (!result.ok) {
      this.emit("log", {
        level: "warn",
        message: `Reglas rechazadas (${result.errors.length} errores)`,
      });
      this.server.sendTo(socket, "mapping-rules", {
        kind: "error",
        message: result.errors.join(" "),
      });
      return;
    }

    this.store
      .save(result.rules)
      .then(() => {
        this.engine.setRules(result.rules);
        this.server.broadcast("mapping-rules", { kind: "update", rules: result.rules });
        this.emit("log", { level: "info", message: `Guardadas ${result.rules.length} reglas de mapeo` });
      })
      .catch((err) => {
        this.emit("log", {
          level: "error",
          message: "No se pudo guardar las reglas de mapeo",
          details: err,
        });
        this.server.sendTo(socket, "mapping-rules", {
          kind: "error",
          message: `No se pudo guardar: ${(err as Error).message ?? err}`,
        });
      });
  }
}
