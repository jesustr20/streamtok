import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AlertasFileSchema,
  DEFAULT_JOIN_GIFT_NAMES,
  isJoinGift,
  type AlertConfig,
  type AlertEvent,
  type AlertKind,
  type LiveEvent,
} from "@streamtok/shared";
import { appDataDir } from "./mapping-rules.js";

/**
 * Motor de alertas de comunidad y nivel (ADR 0014). Convierte eventos que ya existen
 * (`fanLevelUp`, `donorLevelUp` y el regalo con el que se entra a la comunidad) en avisos
 * para los overlays `/overlay/nivel/<id>`, y guarda la configuración de cada overlay.
 *
 * Eventos: `state` (cambia la configuración), `alert` (AlertEvent para mostrar),
 * `log` ({level, message}).
 */

export type PersistedAlertas = ReturnType<typeof AlertasFileSchema.parse>;

export interface AlertasStorePort {
  load(): PersistedAlertas;
  save(data: PersistedAlertas): Promise<void>;
}

export function defaultAlertasFilePath(): string {
  return join(appDataDir(), "alertas.json");
}

export class AlertasStore implements AlertasStorePort {
  constructor(private filePath: string, private onWarn?: (message: string) => void) {}

  load(): PersistedAlertas {
    const defaults = AlertasFileSchema.parse({});
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      }
      return defaults;
    }
    if (raw.trim() === "") return defaults;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.filePath}; se ignora: ${(err as Error).message}`);
      return defaults;
    }
    const parsed = AlertasFileSchema.safeParse(json);
    if (!parsed.success) {
      this.onWarn?.("alertas.json con formato inválido; se ignora.");
      return defaults;
    }
    return parsed.data;
  }

  /** Escritura atómica (archivo temporal + rename). */
  async save(data: PersistedAlertas): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}

const SAMPLE: Record<AlertKind, Omit<AlertEvent, "at">> = {
  fanJoin: { kind: "fanJoin", name: "Usuario de prueba", level: 1 },
  fanLevelUp: { kind: "fanLevelUp", name: "Usuario de prueba", previousLevel: 4, level: 5 },
  donorLevelUp: { kind: "donorLevelUp", name: "Usuario de prueba", previousLevel: 9, level: 10 },
};

const handleKey = (username: string) => username.trim().replace(/^@/, "").toLowerCase();

export interface AlertasEngineOptions {
  store: AlertasStorePort;
  /** alertas que se crean la primera vez (una que borres no reaparece) */
  presets?: AlertConfig[];
}

export class AlertasEngine extends EventEmitter {
  private configs: AlertConfig[];
  private seededIds: string[];
  private joinGiftNames: string[];
  /** quién ya se unió en esta sesión (un combo del regalo no repite el aviso) */
  private joined = new Set<string>();
  private saving = false;
  private dirty = false;
  private store: AlertasStorePort;

  constructor(opts: AlertasEngineOptions) {
    super();
    this.store = opts.store;
    const loaded = this.store.load();
    this.configs = loaded.configs;
    this.seededIds = [...loaded.seededIds];
    this.joinGiftNames = loaded.joinGiftNames.length ? [...loaded.joinGiftNames] : [...DEFAULT_JOIN_GIFT_NAMES];
    let added = false;
    for (const config of opts.presets ?? []) {
      if (this.seededIds.includes(config.id)) continue;
      this.seededIds.push(config.id);
      added = true;
      if (!this.configs.some((c) => c.id === config.id)) this.configs.push(config);
    }
    if (added) this.persist();
  }

  getConfigs(): AlertConfig[] {
    return this.configs;
  }

  getJoinGiftNames(): string[] {
    return this.joinGiftNames;
  }

  save(config: AlertConfig): void {
    const i = this.configs.findIndex((c) => c.id === config.id);
    if (i === -1) this.configs.push(config);
    else this.configs[i] = config;
    this.changed();
  }

  setJoinGiftNames(names: string[]): void {
    const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    this.joinGiftNames = clean.length ? clean : [...DEFAULT_JOIN_GIFT_NAMES];
    this.changed();
  }

  /** Lanza un aviso de ejemplo a todos los overlays (botón "Probar"). */
  test(kind: AlertKind): void {
    this.emit("alert", { ...SAMPLE[kind], at: Date.now() } satisfies AlertEvent);
  }

  handleLiveEvent(evt: LiveEvent): void {
    const name = evt.nickname?.trim() || evt.username.replace(/^@/, "");
    const base = { name, avatarUrl: evt.avatarUrl, at: evt.timestamp };
    if (evt.event === "fanLevelUp" || evt.event === "donorLevelUp") {
      this.emit("alert", { ...base, kind: evt.event, level: evt.newLevel, previousLevel: evt.previousLevel } satisfies AlertEvent);
      return;
    }
    if (evt.event === "gift" && isJoinGift(evt.giftName, this.joinGiftNames)) {
      const key = handleKey(evt.username);
      if (this.joined.has(key)) return;
      this.joined.add(key);
      this.emit("alert", { ...base, kind: "fanJoin", level: evt.fanLevel ?? 1 } satisfies AlertEvent);
    }
  }

  /** Nueva sesión de LIVE: vuelve a avisar a quien ya se había unido. */
  resetSession(): void {
    this.joined.clear();
  }

  private changed(): void {
    this.persist();
    this.emit("state");
  }

  private persist(): void {
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    void (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await this.store.save({ configs: this.configs, seededIds: this.seededIds, joinGiftNames: this.joinGiftNames });
        }
      } catch (err) {
        this.emit("log", { level: "error", message: `No se pudo guardar alertas.json: ${(err as Error).message}` });
      } finally {
        this.saving = false;
      }
    })();
  }
}
