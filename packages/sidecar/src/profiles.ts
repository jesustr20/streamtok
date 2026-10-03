import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import type { WebSocket } from "ws";
import {
  AccionesMessageSchema,
  EventosMessageSchema,
  MappingRuleSchema,
  ProfilesMessageSchema,
  type Accion,
  type Evento,
  type EventLogEntry,
  type MappingRule,
  type ModHelloPayload,
  type Profile,
  type ProfileSummary,
  type ProfilesFile,
} from "@streamtok/shared";
import { validateAcciones, validateEventos } from "./acciones-eventos.js";
import type { AccionesEventosEngine } from "./acciones-eventos-engine.js";
import { EventLogBuffer } from "./event-log.js";
import { migrateLegacyRules, migrateProfilesFile } from "./migration.js";
import { appDataDir } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Perfiles de configuración (ADR 0002) + Acciones/Eventos (ADR 0004). El
 * sidecar es dueño de `profiles.json` y del motor en runtime. La UI gestiona
 * perfiles por `profiles`, y edita acciones/eventos del perfil activo por
 * `acciones`/`eventos`.
 */

const DEFAULT_PROFILE_NAME = "Predeterminado";

export function defaultProfilesFilePath(): string {
  return join(appDataDir(), "profiles.json");
}

export function legacyRulesFilePath(): string {
  return join(appDataDir(), "mapping-rules.json");
}

function newProfile(name: string): Profile {
  return { id: nanoid(), name, acciones: [], eventos: [] };
}

/** Copia profunda de acciones (para "duplicar perfil"). */
function deepCopyAcciones(acciones: Accion[]): Accion[] {
  return acciones.map((a) => ({
    ...a,
    media: { ...a.media },
    comandos: a.comandos.map((c) => ({ ...c, params: { ...c.params } })),
  }));
}

/** Copia profunda de eventos (para "duplicar perfil"). */
function deepCopyEventos(eventos: Evento[]): Evento[] {
  return eventos.map((e) => ({
    ...e,
    accionesTodas: [...e.accionesTodas],
    accionesAleatorias: [...e.accionesAleatorias],
  }));
}

export class ProfilesStore {
  constructor(
    private filePath: string,
    private legacyPath: string = legacyRulesFilePath(),
    private onWarn?: (message: string) => void,
  ) {}

  /**
   * Carga los perfiles. Migra desde `profiles.json` (forma vieja) o desde el
   * `mapping-rules.json` plano a Acciones/Eventos (ADR 0004), sin pérdida de
   * datos. Idempotente: si ya está en la forma nueva, no duplica.
   */
  load(): ProfilesFile {
    const raw = this.readRawJson(this.filePath);
    if (raw !== null) {
      const migrated = migrateProfilesFile(raw);
      if (migrated) return migrated;
      this.onWarn?.("profiles.json con formato inválido o desconocido; se ignora.");
    }

    const legacy = this.readLegacyRules();
    if (legacy) {
      const { acciones, eventos } = migrateLegacyRules(legacy);
      const profile: Profile = { id: nanoid(), name: DEFAULT_PROFILE_NAME, acciones, eventos };
      this.onWarn?.("mapping-rules.json (plano) migrado a un perfil 'Predeterminado'.");
      return { profiles: [profile], activeProfileId: profile.id };
    }

    const profile = newProfile(DEFAULT_PROFILE_NAME);
    return { profiles: [profile], activeProfileId: profile.id };
  }

  async save(file: ProfilesFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }

  private readRawJson(path: string): unknown | null {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onWarn?.(`No se pudo leer ${path}: ${(err as Error).message}`);
      }
      return null;
    }
    if (raw.trim() === "") return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      this.onWarn?.(`JSON corrupto en ${path}; se ignora: ${(err as Error).message}`);
      return null;
    }
  }

  private readLegacyRules(): MappingRule[] | null {
    const raw = this.readRawJson(this.legacyPath);
    if (raw === null) return null;
    const parsed = MappingRuleSchema.array().safeParse(raw);
    if (!parsed.success) {
      this.onWarn?.("mapping-rules.json con formato inválido; se ignora.");
      return null;
    }
    return parsed.data;
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
    private engine: AccionesEventosEngine,
    private getCatalog: () => ModHelloPayload | null,
  ) {
    super();

    this.file = this.store.load();
    // Normaliza: el activo siempre debe apuntar a un perfil existente.
    if (!this.file.profiles.some((p) => p.id === this.file.activeProfileId)) {
      this.file.activeProfileId = this.file.profiles[0].id;
    }
    this.engine.setAcciones(this.activeProfile().acciones);
    this.engine.setEventos(this.activeProfile().eventos);
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

    this.server.onChannel("profiles", (payload, socket) => this.handleProfiles(payload, socket));
    this.server.onChannel("acciones", (payload, socket) => this.handleAcciones(payload, socket));
    this.server.onChannel("eventos", (payload, socket) => this.handleEventos(payload, socket));

    this.engine.on("event-log", (entry: EventLogEntry) => this.pushEventEntry(entry));

    this.server.on("client-connected", (socket) => {
      this.sendAccionesTo(socket);
      this.sendEventosTo(socket);
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

  private summaries(): ProfileSummary[] {
    return this.file.profiles.map((p) => ({ id: p.id, name: p.name, eventoCount: p.eventos.length }));
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

  private sendAccionesTo(socket: WebSocket) {
    this.server.sendTo(socket, "acciones", { kind: "update", acciones: this.engine.getAcciones() });
  }

  private broadcastAcciones() {
    this.server.broadcast("acciones", { kind: "update", acciones: this.engine.getAcciones() });
  }

  private sendEventosTo(socket: WebSocket) {
    this.server.sendTo(socket, "eventos", { kind: "update", eventos: this.engine.getEventos() });
  }

  private broadcastEventos() {
    this.server.broadcast("eventos", { kind: "update", eventos: this.engine.getEventos() });
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
  private commit(socket: WebSocket | null, profileChanged = false): void {
    this.store
      .save(this.file)
      .then(() => {
        if (profileChanged) {
          this.broadcastAcciones();
          this.broadcastEventos();
        }
        this.broadcastState();
      })
      .catch((err) => {
        const message = `No se pudo guardar: ${(err as Error).message ?? err}`;
        this.emit("log", { level: "error", message: "No se pudo guardar los perfiles", details: err });
        if (socket) this.server.sendTo(socket, "profiles", { kind: "error", message });
      });
  }

  // --- canal acciones (opera sobre el perfil activo) ---

  private handleAcciones(payload: unknown, socket: WebSocket) {
    const parsed = AccionesMessageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.kind !== "set") return;

    const result = validateAcciones(parsed.data.acciones, this.getCatalog());
    if (!result.ok) {
      this.emit("log", { level: "warn", message: `Acciones rechazadas (${result.errors.length} errores)` });
      this.server.sendTo(socket, "acciones", { kind: "error", message: result.errors.join(" ") });
      return;
    }

    const active = this.activeProfile();
    active.acciones = result.acciones;
    this.engine.setAcciones(result.acciones);

    this.store
      .save(this.file)
      .then(() => {
        this.broadcastAcciones();
        this.broadcastState();
        this.emit("log", { level: "info", message: `Guardadas ${result.acciones.length} acciones en "${active.name}"` });
      })
      .catch((err) => {
        this.emit("log", { level: "error", message: "No se pudo guardar las acciones", details: err });
        this.server.sendTo(socket, "acciones", {
          kind: "error",
          message: `No se pudo guardar: ${(err as Error).message ?? err}`,
        });
      });
  }

  // --- canal eventos (opera sobre el perfil activo) ---

  private handleEventos(payload: unknown, socket: WebSocket) {
    const parsed = EventosMessageSchema.safeParse(payload);
    if (!parsed.success || parsed.data.kind !== "set") return;

    const result = validateEventos(parsed.data.eventos);
    if (!result.ok) {
      this.emit("log", { level: "warn", message: `Eventos rechazados (${result.errors.length} errores)` });
      this.server.sendTo(socket, "eventos", { kind: "error", message: result.errors.join(" ") });
      return;
    }

    const active = this.activeProfile();
    active.eventos = result.eventos;
    this.engine.setEventos(result.eventos);

    this.store
      .save(this.file)
      .then(() => {
        this.broadcastEventos();
        this.broadcastState();
        this.emit("log", { level: "info", message: `Guardados ${result.eventos.length} eventos en "${active.name}"` });
      })
      .catch((err) => {
        this.emit("log", { level: "error", message: "No se pudo guardar los eventos", details: err });
        this.server.sendTo(socket, "eventos", {
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
      case "get-state":
        // Snapshot bajo demanda: una UI que se monta después de la conexión
        // inicial pide el estado actual (no lo recibió en `client-connected`).
        this.sendStateTo(socket);
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
    const copy: Profile = {
      id: nanoid(),
      name: `${source.name} (copia)`,
      acciones: deepCopyAcciones(source.acciones),
      eventos: deepCopyEventos(source.eventos),
    };
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
    let profileChanged = false;
    if (wasActive) {
      this.file.activeProfileId = this.file.profiles[0].id;
      this.engine.setAcciones(this.file.profiles[0].acciones);
      this.engine.setEventos(this.file.profiles[0].eventos);
      this.resetEventLog();
      profileChanged = true;
    }
    this.commit(socket, profileChanged);
  }

  private setActive(id: string, socket: WebSocket) {
    const profile = this.findProfile(id);
    if (!profile) {
      this.server.sendTo(socket, "profiles", { kind: "error", message: "Perfil no encontrado." });
      return;
    }
    if (this.file.activeProfileId === id) return;
    this.file.activeProfileId = id;
    this.engine.setAcciones(profile.acciones);
    this.engine.setEventos(profile.eventos);
    this.resetEventLog();
    this.commit(socket, true);
  }
}
