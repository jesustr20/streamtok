import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import type { WebSocket } from "ws";
import {
  CommunityRulesMessageSchema,
  defaultCommunityRules,
  MappingRulesMessageSchema,
  MappingRuleSchema,
  ProfilesFileSchema,
  ProfilesMessageSchema,
  type CommunityRules,
  type EventLogEntry,
  type ModHelloPayload,
  type MappingRule,
  type Profile,
  type ProfileSummary,
  type ProfilesFile,
} from "@streamtok/shared";
import { appDataDir, validateRules } from "./mapping-rules.js";
import {
  normalizeCommunityRules,
  validateCommunityRules,
} from "./community-rules.js";
import { EventLogBuffer } from "./event-log.js";
import type { MappingEngine } from "./mapping.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Perfiles de configuración de reglas (ADR 0002). El sidecar es dueño de
 * `profiles.json` y de las reglas en runtime (MappingEngine). La UI gestiona
 * perfiles por el canal `profiles` y edita las reglas del perfil activo por
 * `mapping-rules` (que ahora opera implícitamente sobre el perfil activo).
 */

const DEFAULT_PROFILE_NAME = "Predeterminado";

export function defaultProfilesFilePath(): string {
  return join(appDataDir(), "profiles.json");
}

export function legacyRulesFilePath(): string {
  return join(appDataDir(), "mapping-rules.json");
}

function newProfile(name: string, rules: MappingRule[] = []): Profile {
  return { id: nanoid(), name, rules, communityRules: defaultCommunityRules() };
}

/** Copia profunda de reglas (para "duplicar perfil"). */
function deepCopyRules(rules: MappingRule[]): MappingRule[] {
  return rules.map((r) => ({ ...r, when: { ...r.when }, params: { ...r.params } }));
}

/** Copia profunda de reglas de comunidad (para "duplicar perfil"). */
function deepCopyCommunityRules(cr: CommunityRules): CommunityRules {
  return {
    follow: { ...cr.follow, params: { ...cr.follow.params } },
    share: { ...cr.share, params: { ...cr.share.params } },
    superfan: { ...cr.superfan, params: { ...cr.superfan.params } },
    like: { ...cr.like, params: { ...cr.like.params } },
  };
}

export class ProfilesStore {
  constructor(
    private filePath: string,
    private legacyPath: string = legacyRulesFilePath(),
    private onWarn?: (message: string) => void,
  ) {}

  /**
   * Carga los perfiles. Si `profiles.json` no existe, migra el
   * `mapping-rules.json` plano (si lo hay) a un único perfil activo; si no hay
   * nada, arranca con un perfil "Predeterminado" vacío. Nunca lanza ni pierde
   * reglas: ante corruptos avisa y vuelve al default.
   */
  load(): ProfilesFile {
    const existing = this.readProfilesFile();
    if (existing) return this.migrateCommunityRules(existing);

    const legacy = this.readLegacyRules();
    if (legacy) {
      const profile = newProfile(DEFAULT_PROFILE_NAME, legacy);
      this.onWarn?.("mapping-rules.json (plano) migrado a un perfil 'Predeterminado'.");
      return { profiles: [profile], activeProfileId: profile.id };
    }

    const profile = newProfile(DEFAULT_PROFILE_NAME);
    return { profiles: [profile], activeProfileId: profile.id };
  }

  /** Asegura que todo perfil tenga sus 4 slots de reglas de comunidad (ADR 0003):
   * los perfiles anteriores a esta feature no traen el campo. */
  private migrateCommunityRules(file: ProfilesFile): ProfilesFile {
    return {
      ...file,
      profiles: file.profiles.map((p) => ({
        ...p,
        communityRules: p.communityRules
          ? normalizeCommunityRules(p.communityRules)
          : defaultCommunityRules(),
      })),
    };
  }

  async save(file: ProfilesFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }

  private readProfilesFile(): ProfilesFile | null {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.filePath}: ${(err as Error).message}`);
      }
      return null;
    }
    if (raw.trim() === "") return null;
    try {
      const data: unknown = JSON.parse(raw);
      const parsed = ProfilesFileSchema.safeParse(data);
      if (!parsed.success) {
        this.onWarn?.(`Perfiles con formato inválido en ${this.filePath}; se ignoran.`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.filePath}; se ignora: ${(err as Error).message}`);
      return null;
    }
  }

  private readLegacyRules(): MappingRule[] | null {
    let raw: string;
    try {
      raw = readFileSync(this.legacyPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${this.legacyPath}: ${(err as Error).message}`);
      }
      return null;
    }
    if (raw.trim() === "") return null;
    try {
      const data: unknown = JSON.parse(raw);
      const parsed = MappingRuleSchema.array().safeParse(data);
      if (!parsed.success) {
        this.onWarn?.(`mapping-rules.json con formato inválido; se ignora.`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${this.legacyPath}; se ignora: ${(err as Error).message}`);
      return null;
    }
  }
}

export class ProfilesController extends EventEmitter {
  private file: ProfilesFile;
  /** Cola de eventos in-memory (issue #17), acotada y sin persistencia. Se
   * resetea al cambiar de perfil activo (un solo buffer, no uno por perfil). */
  private eventLog = new EventLogBuffer();

  constructor(
    private server: StreamTokWsServer,
    private store: ProfilesStore,
    private engine: MappingEngine,
    private getCatalog: () => ModHelloPayload | null,
  ) {
    super();

    this.file = this.store.load();
    // Normaliza: el activo siempre debe apuntar a un perfil existente.
    if (!this.file.profiles.some((p) => p.id === this.file.activeProfileId)) {
      this.file.activeProfileId = this.file.profiles[0].id;
    }
    this.engine.setRules(this.activeProfile().rules);
    this.engine.setCommunityRules(this.activeCommunityRules());
    this.emit("log", {
      level: "info",
      message: `Cargados ${this.file.profiles.length} perfiles (activo: "${this.activeProfile().name}")`,
    });
    // Materializa profiles.json si hubo migración o instalación fresca.
    void this.store.save(this.file).catch((err) => {
      this.emit("log", {
        level: "error",
        message: "No se pudo persistir la migración de perfiles",
        details: err,
      });
    });

    this.server.onChannel("mapping-rules", (payload, socket) => this.handleRules(payload, socket));
    this.server.onChannel("profiles", (payload, socket) => this.handleProfiles(payload, socket));
    this.server.onChannel("community-rules", (payload, socket) =>
      this.handleCommunityRules(payload, socket),
    );

    this.engine.on("event-log", (entry: EventLogEntry) => this.pushEventEntry(entry));

    this.server.on("client-connected", (socket) => {
      this.sendRulesTo(socket);
      this.sendCommunityRulesTo(socket);
      this.sendStateTo(socket);
      this.sendEventLogTo(socket);
    });
  }

  private findProfile(id: string): Profile | undefined {
    return this.file.profiles.find((p) => p.id === id);
  }

  private activeProfile(): Profile {
    return this.file.profiles.find((p) => p.id === this.file.activeProfileId) ?? this.file.profiles[0];
  }

  private communityRulesOf(profile: Profile): CommunityRules {
    return profile.communityRules ?? defaultCommunityRules();
  }

  private activeCommunityRules(): CommunityRules {
    return this.communityRulesOf(this.activeProfile());
  }

  private summaries(): ProfileSummary[] {
    return this.file.profiles.map((p) => ({ id: p.id, name: p.name, ruleCount: p.rules.length }));
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "profiles", {
      kind: "state",
      profiles: this.summaries(),
      activeProfileId: this.file.activeProfileId,
    });
  }

  private broadcastState() {
    this.server.broadcast("profiles", {
      kind: "state",
      profiles: this.summaries(),
      activeProfileId: this.file.activeProfileId,
    });
  }

  private sendRulesTo(socket: WebSocket) {
    this.server.sendTo(socket, "mapping-rules", { kind: "update", rules: this.engine.getRules() });
  }

  private broadcastRules() {
    this.server.broadcast("mapping-rules", { kind: "update", rules: this.engine.getRules() });
  }

  private sendCommunityRulesTo(socket: WebSocket) {
    this.server.sendTo(socket, "community-rules", { kind: "update", rules: this.activeCommunityRules() });
  }

  private broadcastCommunityRules() {
    this.server.broadcast("community-rules", { kind: "update", rules: this.activeCommunityRules() });
  }

  private sendEventLogTo(socket: WebSocket) {
    this.server.sendTo(socket, "event-log", { kind: "snapshot", entries: this.eventLog.getEntries() });
  }

  private pushEventEntry(entry: EventLogEntry) {
    this.eventLog.append(entry);
    this.server.broadcast("event-log", { kind: "append", entry });
  }

  /** Vacía la cola (al cambiar de perfil activo) y avisa a los clientes. */
  private resetEventLog() {
    this.eventLog.reset();
    this.server.broadcast("event-log", { kind: "snapshot", entries: [] });
  }

  /** Persiste y hace broadcast. En error avisa y (si hay socket) responde. */
  private commit(socket: WebSocket | null, rulesChanged = false): void {
    this.store
      .save(this.file)
      .then(() => {
        if (rulesChanged) {
          this.broadcastRules();
          this.broadcastCommunityRules();
        }
        this.broadcastState();
      })
      .catch((err) => {
        const message = `No se pudo guardar: ${(err as Error).message ?? err}`;
        this.emit("log", { level: "error", message: "No se pudo guardar los perfiles", details: err });
        if (socket) this.server.sendTo(socket, "profiles", { kind: "error", message });
      });
  }

  // --- canal mapping-rules (opera sobre el perfil activo) ---

  private handleRules(payload: unknown, socket: WebSocket) {
    const parsed = MappingRulesMessageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.kind !== "set") return;

    const result = validateRules(parsed.data.rules, this.getCatalog());
    if (!result.ok) {
      this.emit("log", { level: "warn", message: `Reglas rechazadas (${result.errors.length} errores)` });
      this.server.sendTo(socket, "mapping-rules", { kind: "error", message: result.errors.join(" ") });
      return;
    }

    const active = this.activeProfile();
    active.rules = result.rules;
    this.engine.setRules(result.rules);

    this.store
      .save(this.file)
      .then(() => {
        this.broadcastRules();
        this.broadcastState();
        this.emit("log", { level: "info", message: `Guardadas ${result.rules.length} reglas en "${active.name}"` });
      })
      .catch((err) => {
        this.emit("log", { level: "error", message: "No se pudo guardar las reglas", details: err });
        this.server.sendTo(socket, "mapping-rules", {
          kind: "error",
          message: `No se pudo guardar: ${(err as Error).message ?? err}`,
        });
      });
  }

  // --- canal community-rules (opera sobre el perfil activo) ---

  private handleCommunityRules(payload: unknown, socket: WebSocket) {
    const parsed = CommunityRulesMessageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.kind !== "set") return;

    const result = validateCommunityRules(parsed.data.rules, this.getCatalog());
    if (!result.ok) {
      this.emit("log", {
        level: "warn",
        message: `Reglas de comunidad rechazadas (${result.errors.length} errores)`,
      });
      this.server.sendTo(socket, "community-rules", { kind: "error", message: result.errors.join(" ") });
      return;
    }

    const active = this.activeProfile();
    active.communityRules = result.rules;
    this.engine.setCommunityRules(result.rules);

    this.store
      .save(this.file)
      .then(() => {
        this.broadcastCommunityRules();
        this.broadcastState();
        this.emit("log", { level: "info", message: `Guardadas reglas de comunidad en "${active.name}"` });
      })
      .catch((err) => {
        this.emit("log", { level: "error", message: "No se pudo guardar las reglas de comunidad", details: err });
        this.server.sendTo(socket, "community-rules", {
          kind: "error",
          message: `No se pudo guardar: ${(err as Error).message ?? err}`,
        });
      });
  }

  // --- canal profiles (CRUD + set-active) ---

  private handleProfiles(payload: unknown, socket: WebSocket) {
    const parsed = ProfilesMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Mensaje de perfiles inválido." });
      return;
    }
    switch (parsed.data.kind) {
      case "create":
        this.create(parsed.data.name, socket);
        break;
      case "duplicate":
        this.duplicate(parsed.data.id, socket);
        break;
      case "rename":
        this.rename(parsed.data.id, parsed.data.name, socket);
        break;
      case "delete":
        this.remove(parsed.data.id, socket);
        break;
      case "set-active":
        this.setActive(parsed.data.id, socket);
        break;
      default:
        // "state"/"error" los emite el sidecar; se ignoran entrantes.
        break;
    }
  }

  private create(name: string, socket: WebSocket) {
    const trimmed = name.trim();
    if (!trimmed) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "El nombre del perfil no puede estar vacío." });
      return;
    }
    this.file.profiles.push(newProfile(trimmed));
    this.emit("log", { level: "info", message: `Perfil creado: "${trimmed}"` });
    this.commit(socket);
  }

  private duplicate(id: string, socket: WebSocket) {
    const source = this.findProfile(id);
    if (!source) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Perfil no encontrado." });
      return;
    }
    const copy = newProfile(`${source.name} (copia)`, deepCopyRules(source.rules));
    copy.communityRules = deepCopyCommunityRules(this.communityRulesOf(source));
    this.file.profiles.push(copy);
    this.commit(socket);
  }

  private rename(id: string, name: string, socket: WebSocket) {
    const profile = this.findProfile(id);
    if (!profile) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Perfil no encontrado." });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "El nombre del perfil no puede estar vacío." });
      return;
    }
    profile.name = trimmed;
    this.commit(socket);
  }

  private remove(id: string, socket: WebSocket) {
    if (this.file.profiles.length <= 1) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "No se puede borrar el último perfil." });
      return;
    }
    const index = this.file.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Perfil no encontrado." });
      return;
    }
    const wasActive = this.file.activeProfileId === id;
    this.file.profiles.splice(index, 1);
    let rulesChanged = false;
    if (wasActive) {
      this.file.activeProfileId = this.file.profiles[0].id;
      this.engine.setRules(this.file.profiles[0].rules);
      this.engine.setCommunityRules(this.communityRulesOf(this.file.profiles[0]));
      this.resetEventLog();
      rulesChanged = true;
    }
    this.commit(socket, rulesChanged);
  }

  private setActive(id: string, socket: WebSocket) {
    const profile = this.findProfile(id);
    if (!profile) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Perfil no encontrado." });
      return;
    }
    if (this.file.activeProfileId === id) return;
    this.file.activeProfileId = id;
    this.engine.setRules(profile.rules);
    this.engine.setCommunityRules(this.communityRulesOf(profile));
    this.resetEventLog();
    this.commit(socket, true);
  }
}
