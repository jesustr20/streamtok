import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  defaultCommunityRules,
  type CommunityRules,
  type EventLogEntry,
  type LiveEvent,
  type ProfilesFile,
} from "@streamtok/shared";
import { EventLogBuffer, reasonForCommandError } from "../src/event-log.js";
import { MappingEngine } from "../src/mapping.js";
import { ModBridge } from "../src/mod-bridge.js";
import { ProfilesController, ProfilesStore } from "../src/profiles.js";
import { StreamTokWsServer } from "../src/ws-server.js";

function makeBridge(ackError?: string) {
  const calls: Array<{ action: string; params: Record<string, number | string | boolean> }> = [];
  const bridge = {
    calls,
    async sendCommand(action: string, params: Record<string, number | string | boolean>) {
      calls.push({ action, params });
      if (ackError !== undefined) return { id: "id", ok: false, error: ackError };
      return { id: "id", ok: true };
    },
    getAction() {
      return undefined;
    },
  };
  return bridge as unknown as ModBridge;
}

function collect(engine: MappingEngine): { entries: EventLogEntry[] } {
  const entries: EventLogEntry[] = [];
  engine.on("event-log", (e) => entries.push(e as EventLogEntry));
  return { entries };
}

function followEvent(): LiveEvent {
  return { event: "follow", username: "@u", timestamp: 0 };
}

describe("EventLogBuffer", () => {
  it("se mantiene acotado: las entradas más viejas se descartan", () => {
    const buf = new EventLogBuffer(50);
    for (let i = 0; i < 60; i++) {
      buf.append({ id: `e${i}`, at: i, status: "discarded", event: "like", message: `m${i}` });
    }
    const entries = buf.getEntries();
    expect(entries).toHaveLength(50);
    expect(entries[0].id).toBe("e10"); // se descartaron e0..e9
    expect(entries[entries.length - 1].id).toBe("e59");
  });

  it("reset vacía la cola", () => {
    const buf = new EventLogBuffer();
    buf.append({ id: "e0", at: 0, status: "fired", event: "like", message: "x" });
    buf.reset();
    expect(buf.getEntries()).toEqual([]);
  });
});

describe("reasonForCommandError", () => {
  it("mapea los errores reales de sendCommand", () => {
    expect(reasonForCommandError("Mod no conectado")).toBe("mod-not-connected");
    expect(reasonForCommandError("Descartado: demasiados comandos en cola")).toBe("queue-full");
    expect(reasonForCommandError("Timeout esperando mod-ack")).toBe("ack-timeout");
    expect(reasonForCommandError("cualquier otra cosa")).toBe("command-error");
    expect(reasonForCommandError(undefined)).toBe("command-error");
  });
});

describe("MappingEngine — emisión de entradas de cola", () => {
  it("regla de mapeo que coincide → entrada fired con acción y ruleId", async () => {
    const engine = new MappingEngine(makeBridge());
    engine.setRules([{ id: "r1", when: { event: "follow" }, action: "arena_join", params: {} }]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("fired");
    expect(entries[0].action).toBe("arena_join");
    expect(entries[0].ruleId).toBe("r1");
    expect(entries[0].reason).toBeUndefined();
  });

  it("slot de comunidad que dispara → entrada fired con communityKind", async () => {
    const engine = new MappingEngine(makeBridge());
    const cr: CommunityRules = {
      ...defaultCommunityRules(),
      follow: { enabled: true, action: "arena_join", params: {} },
    };
    engine.setCommunityRules(cr);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("fired");
    expect(entries[0].communityKind).toBe("follow");
  });

  it("evento sin regla que coincida → descarte no-match", async () => {
    const engine = new MappingEngine(makeBridge());
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "join", username: "@u", timestamp: 0 });

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("discarded");
    expect(entries[0].reason).toBe("no-match");
  });

  it("regalo en mitad de streak → descarte gift-in-progress", async () => {
    const engine = new MappingEngine(makeBridge());
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "gift", username: "@u", repeatEnd: false, timestamp: 0 });

    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("gift-in-progress");
  });

  it("comando fallido por mod no conectado → descarte mod-not-connected", async () => {
    const engine = new MappingEngine(makeBridge("Mod no conectado"));
    engine.setRules([{ id: "r1", when: { event: "follow" }, action: "arena_join", params: {} }]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("discarded");
    expect(entries[0].reason).toBe("mod-not-connected");
  });

  it("like por debajo del umbral → descarte like-threshold y luego fired al alcanzarlo", async () => {
    const engine = new MappingEngine(makeBridge());
    const cr: CommunityRules = {
      ...defaultCommunityRules(),
      like: { enabled: true, action: "like_action", params: {}, everyNLikes: 2 },
    };
    engine.setCommunityRules(cr);
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "like", username: "@u", timestamp: 0 });
    await engine.handleEvent({ event: "like", username: "@u", timestamp: 0 });

    expect(entries).toHaveLength(2);
    expect(entries[0].status).toBe("discarded");
    expect(entries[0].reason).toBe("like-threshold");
    expect(entries[1].status).toBe("fired");
    expect(entries[1].action).toBe("like_action");
  });
});

describe("ProfilesController — canal event-log", () => {
  let server: StreamTokWsServer;
  let dir: string;
  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-eventlog-"));
    return { profilesPath: join(dir, "profiles.json"), legacyPath: join(dir, "mapping-rules.json") };
  }

  async function waitListening(): Promise<number> {
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  function once(ws: WebSocket, channel: string): Promise<any> {
    return new Promise((resolve) => {
      ws.on("message", function handler(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.channel === channel) {
          ws.off("message", handler);
          resolve(msg.payload);
        }
      });
    });
  }

  function seed(profilesPath: string, file: ProfilesFile) {
    writeFileSync(profilesPath, JSON.stringify(file));
  }

  it("reenvía la cola actual a un cliente que se conecta tarde", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);

    // genera una entrada antes de que nadie se conecte
    await engine.handleEvent({ event: "join", username: "@u", timestamp: 0 });

    const port = await waitListening();
    const ws = new WebSocket(`ws://localhost:${port}`);
    const snap = once(ws, "event-log");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const payload = await snap;
    expect(payload.kind).toBe("snapshot");
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].reason).toBe("no-match");

    ws.close();
  });

  it("resetea la cola y avisa al cambiar de perfil activo", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();

    const ws = new WebSocket(`ws://localhost:${port}`);
    const initialSnap = once(ws, "event-log");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const initial = await initialSnap;
    expect(initial.kind).toBe("snapshot");
    expect(initial.entries).toHaveLength(0);

    // genera una entrada
    const append = once(ws, "event-log");
    await engine.handleEvent({ event: "join", username: "@u", timestamp: 0 });
    const a = await append;
    expect(a.kind).toBe("append");
    expect(a.entry.reason).toBe("no-match");

    // cambia de perfil → snapshot vacío
    const snapAfter = once(ws, "event-log");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "set-active", id: "p2" } }));
    const after = await snapAfter;
    expect(after.kind).toBe("snapshot");
    expect(after.entries).toHaveLength(0);

    ws.close();
  });
});
