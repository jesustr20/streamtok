import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  defaultCommunityRules,
  type CommunityRules,
  type ModHelloPayload,
  type ProfilesFile,
} from "@streamtok/shared";
import { normalizeCommunityRules, validateCommunityRules } from "../src/community-rules.js";
import { MappingEngine } from "../src/mapping.js";
import { ModBridge } from "../src/mod-bridge.js";
import { ProfilesController, ProfilesStore } from "../src/profiles.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const catalog: ModHelloPayload = {
  mod: "gtav-chaos",
  version: "0.9.0",
  actions: [
    {
      id: "arena_join",
      name: "Unirse a la arena",
      category: "arena",
      icon: "arena",
      description: "El viewer entra a la pelea",
      supportsNameTag: true,
      params: [
        { name: "character", type: "enum", default: "default", options: ["default", "npc"] },
        { name: "coins", type: "int", default: 0 },
      ],
    },
  ],
};

function enabledRule(action = "arena_join", params: Record<string, number | string | boolean> = {}): CommunityRules {
  return {
    ...defaultCommunityRules(),
    follow: { enabled: true, action, params },
  };
}

describe("normalizeCommunityRules", () => {
  it("sin input → los 4 slots default (deshabilitados, sin acción)", () => {
    const rules = normalizeCommunityRules(undefined);
    expect(rules).toEqual(defaultCommunityRules());
    expect(rules.follow).toEqual({ enabled: false, action: "", params: {} });
    expect(rules.like.everyNLikes).toBe(1);
  });

  it("completa slots faltantes y descarta everyNLikes fuera de like", () => {
    const rules = normalizeCommunityRules({
      follow: { enabled: true, action: "arena_join", params: { coins: 5 }, everyNLikes: 9 },
    });
    expect(rules.follow.enabled).toBe(true);
    expect(rules.follow.action).toBe("arena_join");
    expect(rules.follow).not.toHaveProperty("everyNLikes");
    expect(rules.share).toEqual({ enabled: false, action: "", params: {} });
    expect(rules.superfan).toEqual({ enabled: false, action: "", params: {} });
    expect(rules.like.everyNLikes).toBe(1);
  });

  it("rellena everyNLikes a 1 en like si falta", () => {
    const rules = normalizeCommunityRules({
      ...defaultCommunityRules(),
      like: { enabled: true, action: "arena_join", params: {} },
    });
    expect(rules.like.everyNLikes).toBe(1);
  });
});

describe("validateCommunityRules", () => {
  it("acepta un objeto válido y normaliza", () => {
    const result = validateCommunityRules(enabledRule(), catalog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rules.follow.action).toBe("arena_join");
  });

  it("sin catálogo valida solo la forma", () => {
    expect(validateCommunityRules(enabledRule(), null).ok).toBe(true);
    expect(validateCommunityRules("basura", null).ok).toBe(false);
  });

  it("rechaza una acción que no existe en el catálogo", () => {
    const result = validateCommunityRules(enabledRule("no_existe"), catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/no_existe/);
  });

  it("rechaza un parámetro que la acción no define", () => {
    const result = validateCommunityRules(enabledRule("arena_join", { foo: 1 }), catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/foo/);
  });

  it("no valida slots sin acción asignada (aunque estén deshabilitados)", () => {
    const result = validateCommunityRules(defaultCommunityRules(), catalog);
    expect(result.ok).toBe(true);
  });
});

describe("MappingEngine — reglas de comunidad", () => {
  function makeBridge() {
    const calls: Array<{ action: string; params: Record<string, number | string | boolean> }> = [];
    const bridge = {
      calls,
      async sendCommand(action: string, params: Record<string, number | string | boolean>) {
        calls.push({ action, params });
        return { id: "id", ok: true };
      },
      getAction() {
        return undefined;
      },
    };
    return bridge as unknown as ModBridge;
  }

  function likeEvent(): Parameters<MappingEngine["handleEvent"]>[0] {
    return { event: "like", username: "@fan", timestamp: Date.now() };
  }

  it("dispara follow/share/superfan cuando están habilitados con acción", async () => {
    const bridge = makeBridge();
    const engine = new MappingEngine(bridge);
    engine.setCommunityRules({
      ...defaultCommunityRules(),
      follow: { enabled: true, action: "a", params: {} },
      share: { enabled: true, action: "b", params: {} },
      superfan: { enabled: true, action: "c", params: {} },
    });

    await engine.handleEvent({ event: "follow", username: "@u", timestamp: 0 });
    await engine.handleEvent({ event: "share", username: "@u", timestamp: 0 });
    await engine.handleEvent({ event: "subscribe", username: "@u", timestamp: 0 });

    expect(bridge.calls.map((c) => c.action)).toEqual(["a", "b", "c"]);
  });

  it("no dispara un slot deshabilitado", async () => {
    const bridge = makeBridge();
    const engine = new MappingEngine(bridge);
    engine.setCommunityRules(defaultCommunityRules()); // todo deshabilitado

    await engine.handleEvent({ event: "follow", username: "@u", timestamp: 0 });
    await engine.handleEvent({ event: "share", username: "@u", timestamp: 0 });
    await engine.handleEvent({ event: "subscribe", username: "@u", timestamp: 0 });

    expect(bridge.calls).toHaveLength(0);
  });

  it("likes: dispara cada N likes (no en cada like)", async () => {
    const bridge = makeBridge();
    const engine = new MappingEngine(bridge);
    engine.setCommunityRules({
      ...defaultCommunityRules(),
      like: { enabled: true, action: "like_action", params: {}, everyNLikes: 3 },
    });

    for (let i = 0; i < 7; i++) await engine.handleEvent(likeEvent());

    // dispara en el like #3 y #6
    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls.every((c) => c.action === "like_action")).toBe(true);
  });

  it("likes deshabilitado: no dispara ni cuenta", async () => {
    const bridge = makeBridge();
    const engine = new MappingEngine(bridge);
    engine.setCommunityRules(defaultCommunityRules()); // like deshabilitado

    for (let i = 0; i < 5; i++) await engine.handleEvent(likeEvent());
    expect(bridge.calls).toHaveLength(0);
  });

  it("setCommunityRules resetea el contador de likes", async () => {
    const bridge = makeBridge();
    const engine = new MappingEngine(bridge);
    const rules: CommunityRules = {
      ...defaultCommunityRules(),
      like: { enabled: true, action: "like_action", params: {}, everyNLikes: 3 },
    };
    engine.setCommunityRules(rules);

    for (let i = 0; i < 2; i++) await engine.handleEvent(likeEvent());
    expect(bridge.calls).toHaveLength(0);

    engine.setCommunityRules(rules); // reset
    for (let i = 0; i < 2; i++) await engine.handleEvent(likeEvent());
    expect(bridge.calls).toHaveLength(0);

    await engine.handleEvent(likeEvent()); // 3er like desde el reset
    expect(bridge.calls).toHaveLength(1);
  });
});

describe("ProfilesStore — migración de reglas de comunidad (ADR 0003)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-community-"));
    return { profilesPath: join(dir, "profiles.json"), legacyPath: join(dir, "mapping-rules.json") };
  }

  it("perfiles sin communityRules → 4 slots default al cargar", () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(
      profilesPath,
      JSON.stringify({ profiles: [{ id: "p1", name: "Uno", rules: [] }], activeProfileId: "p1" }),
    );
    const file = new ProfilesStore(profilesPath, legacyPath).load();
    expect(file.profiles[0].communityRules).toEqual(defaultCommunityRules());
  });

  it("perfiles con communityRules presentes → se preservan (no se pisan con defaults)", () => {
    const { profilesPath, legacyPath } = tmpDir();
    const cr: CommunityRules = {
      ...defaultCommunityRules(),
      follow: { enabled: true, action: "arena_join", params: { character: "default" } },
    };
    writeFileSync(
      profilesPath,
      JSON.stringify({
        profiles: [{ id: "p1", name: "Uno", rules: [], communityRules: cr }],
        activeProfileId: "p1",
      }),
    );
    const file = new ProfilesStore(profilesPath, legacyPath).load();
    expect(file.profiles[0].communityRules).toEqual(cr);
  });

  it("round-trip: umbral de likes y configuración sobreviven a guardar/releer", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    const cr: CommunityRules = {
      ...defaultCommunityRules(),
      follow: { enabled: true, action: "arena_join", params: { character: "default" } },
      like: { enabled: true, action: "arena_join", params: {}, everyNLikes: 7 },
    };
    const file: ProfilesFile = {
      profiles: [{ id: "p1", name: "Uno", rules: [], communityRules: cr }],
      activeProfileId: "p1",
    };
    await new ProfilesStore(profilesPath, legacyPath).save(file);
    const loaded = new ProfilesStore(profilesPath, legacyPath).load();
    expect(loaded.profiles[0].communityRules).toEqual(cr);
  });
});

describe("ProfilesController — reglas de comunidad", () => {
  let server: StreamTokWsServer;
  let dir: string;
  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-community-ctrl-"));
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

  it("carga las community rules del perfil activo en el engine", () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [], communityRules: enabledRule() },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    expect(engine.getCommunityRules().follow.enabled).toBe(true);
  });

  it("set-active cambia las community rules vigentes y las reenvía", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [], communityRules: enabledRule() },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();

    const ws = new WebSocket(`ws://localhost:${port}`);
    const initial = once(ws, "community-rules");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const first = await initial;
    expect(first.rules.follow.enabled).toBe(true);

    const after = once(ws, "community-rules");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "set-active", id: "p2" } }));
    const second = await after;
    expect(second.rules.follow.enabled).toBe(false);
    expect(engine.getCommunityRules().follow.enabled).toBe(false);

    ws.close();
  });

  it("community-rules set persiste en el perfil activo (umbral de likes incluido)", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const rules: CommunityRules = {
      ...defaultCommunityRules(),
      like: { enabled: true, action: "arena_join", params: { coins: 3 }, everyNLikes: 5 },
    };
    const update = once(ws, "community-rules");
    ws.send(JSON.stringify({ channel: "community-rules", payload: { kind: "set", rules } }));
    const payload = await update;
    expect(payload).toEqual({ kind: "update", rules });
    expect(engine.getCommunityRules().like.everyNLikes).toBe(5);

    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === onDisk.activeProfileId)?.communityRules).toEqual(rules);

    ws.close();
  });
});
