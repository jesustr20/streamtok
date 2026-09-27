import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { MappingRule, ProfilesFile } from "@streamtok/shared";
import { MappingEngine } from "../src/mapping.js";
import { ModBridge } from "../src/mod-bridge.js";
import { ProfilesController, ProfilesStore } from "../src/profiles.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const validRule: MappingRule = {
  id: "r1",
  when: { event: "gift", giftId: 5655 },
  action: "arena_join",
  params: { character: "default", coins: 0 },
  passCoinsAsParam: "coins",
};

const validRule2: MappingRule = {
  id: "r2",
  when: { event: "comment", command: "!carro" },
  action: "vehicle_spawn_random",
  params: { amount: 1 },
};

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

describe("ProfilesStore", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-profiles-"));
    return { profilesPath: join(dir, "profiles.json"), legacyPath: join(dir, "mapping-rules.json") };
  }

  it("migra mapping-rules.json plano a un único perfil activo", () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(legacyPath, JSON.stringify([validRule, validRule2]));

    const file = new ProfilesStore(profilesPath, legacyPath).load();

    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].name).toBe("Predeterminado");
    expect(file.profiles[0].rules).toEqual([validRule, validRule2]);
    expect(file.activeProfileId).toBe(file.profiles[0].id);
  });

  it("arranque fresco sin archivos → un perfil 'Predeterminado' vacío activo", () => {
    const { profilesPath, legacyPath } = tmpDir();
    const file = new ProfilesStore(profilesPath, legacyPath).load();

    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].name).toBe("Predeterminado");
    expect(file.profiles[0].rules).toEqual([]);
    expect(file.activeProfileId).toBe(file.profiles[0].id);
  });

  it("profiles.json corrupto → cae al default y avisa", () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(profilesPath, "{no es json");
    const warnings: string[] = [];
    const file = new ProfilesStore(profilesPath, legacyPath, (m) => warnings.push(m)).load();

    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].rules).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("round-trip: guardar y releer con otra instancia", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    const file: ProfilesFile = {
      profiles: [
        { id: "p1", name: "Uno", rules: [validRule] },
        { id: "p2", name: "Dos", rules: [validRule2] },
      ],
      activeProfileId: "p2",
    };
    await new ProfilesStore(profilesPath, legacyPath).save(file);
    expect(new ProfilesStore(profilesPath, legacyPath).load()).toEqual(file);
  });
});

describe("ProfilesController", () => {
  let server: StreamTokWsServer;
  let dir: string;

  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-profiles-ctrl-"));
    return { profilesPath: join(dir, "profiles.json"), legacyPath: join(dir, "mapping-rules.json") };
  }

  async function waitListening(): Promise<number> {
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  /** Conecta una UI y drena los mensajes iniciales (mapping-rules + profiles). */
  async function connectUI(port: number): Promise<{ ws: WebSocket; initialState: any }> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const initialRules = once(ws, "mapping-rules");
    const initialState = once(ws, "profiles");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await initialRules;
    const state = await initialState;
    return { ws, initialState: state };
  }

  function seed(profilesPath: string, file: ProfilesFile) {
    writeFileSync(profilesPath, JSON.stringify(file));
  }

  it("carga el perfil activo en el MappingEngine al arrancar", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [validRule] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });

    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);

    expect(engine.getRules()).toEqual([validRule]);
  });

  it("set-active cambia las reglas que usa el MappingEngine", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [validRule] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const rulesAfter = once(ws, "mapping-rules");
    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "set-active", id: "p2" } }));
    await rulesAfter;
    const st = await stateAfter;
    expect(engine.getRules()).toEqual([]);
    expect(st.activeProfileId).toBe("p2");

    const rulesBack = once(ws, "mapping-rules");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "set-active", id: "p1" } }));
    await rulesBack;
    expect(engine.getRules()).toEqual([validRule]);

    ws.close();
  });

  it("crea un perfil vacío", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new MappingEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws, initialState } = await connectUI(port);
    expect(initialState.profiles).toHaveLength(1);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "create", name: "Nuevo" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(2);
    expect(st.profiles.map((p: any) => p.name)).toContain("Nuevo");

    ws.close();
  });

  it("duplica un perfil copiando sus reglas", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [validRule, validRule2] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new MappingEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "duplicate", id: "p1" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(3);
    const copy = st.profiles.find((p: any) => p.id !== "p1" && p.id !== "p2");
    expect(copy.ruleCount).toBe(2);

    // verifica que el disco guardó la copia con sus reglas
    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === copy.id)?.rules).toEqual([validRule, validRule2]);

    ws.close();
  });

  it("renombra un perfil", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [{ id: "p1", name: "Uno", rules: [] }],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new MappingEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "rename", id: "p1", name: "Renombrado" } }));
    const st = await stateAfter;
    expect(st.profiles[0].name).toBe("Renombrado");

    ws.close();
  });

  it("borra un perfil no activo", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new MappingEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "delete", id: "p2" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(1);
    expect(st.profiles[0].id).toBe("p1");

    ws.close();
  });

  it("borrar el perfil activo reasigna el activo y cambia las reglas", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", rules: [validRule] },
        { id: "p2", name: "Dos", rules: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const rulesAfter = once(ws, "mapping-rules");
    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "delete", id: "p1" } }));
    await rulesAfter;
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(1);
    expect(st.activeProfileId).toBe("p2");
    expect(engine.getRules()).toEqual([]);

    ws.close();
  });

  it("rechaza borrar el último perfil", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new MappingEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws, initialState } = await connectUI(port);
    const onlyId = initialState.profiles[0].id;

    const errPromise = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "delete", id: onlyId } }));
    const resp = await errPromise;
    expect(resp.kind).toBe("error");
    expect(resp.message).toMatch(/último/);

    ws.close();
  });

  it("mapping-rules set guarda en el perfil activo y lo persiste", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const update = once(ws, "mapping-rules");
    ws.send(JSON.stringify({ channel: "mapping-rules", payload: { kind: "set", rules: [validRule] } }));
    const payload = await update;
    expect(payload).toEqual({ kind: "update", rules: [validRule] });
    expect(engine.getRules()).toEqual([validRule]);

    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === onDisk.activeProfileId)?.rules).toEqual([validRule]);

    ws.close();
  });
});
