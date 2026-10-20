import { readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_PROVIDERS, type AgentProviderId } from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Claves de los proveedores de modelo. Son TUYAS: se guardan solo en este equipo (`agente-keys.json`,
 * aparte de `agente.json`) y solo las lee el sidecar. Nunca se mandan al overlay ni a la app.
 */
export interface KeysFile {
  keys: Partial<Record<AgentProviderId, string>>;
}

/** Se queda solo con los proveedores conocidos y claves de texto (sin dependencias nuevas). */
function parseKeys(json: unknown): KeysFile | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = (json as { keys?: unknown }).keys;
  if (raw === undefined) return { keys: {} };
  if (typeof raw !== "object" || raw === null) return null;
  const keys: KeysFile["keys"] = {};
  for (const p of AGENT_PROVIDERS) {
    const v = (raw as Record<string, unknown>)[p.id];
    if (typeof v === "string" && v) keys[p.id] = v;
  }
  return { keys };
}

export interface KeysStorePort {
  load(): KeysFile;
  save(data: KeysFile): Promise<void>;
}

export function defaultKeysFilePath(): string {
  return join(appDataDir(), "agente-keys.json");
}

export class KeysStore implements KeysStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): KeysFile {
    const defaults: KeysFile = { keys: {} };
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      return defaults;
    }
    if (raw.trim() === "") return defaults;
    try {
      const parsed = parseKeys(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      /* cae abajo */
    }
    this.onWarn?.("agente-keys.json con formato inválido; se ignora.");
    return defaults;
  }

  /** Escritura atómica; en sistemas tipo Unix, solo legible por tu usuario. */
  async save(data: KeysFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.filePath);
    try {
      await chmod(this.filePath, 0o600);
    } catch {
      /* Windows: el permiso lo da la carpeta del usuario */
    }
  }
}

export type { AgentProviderId };
