import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { Accion, Evento, ProfilesFile } from "@streamtok/shared";
import { AccionesEventosEngine } from "../src/acciones-eventos-engine.js";
import { ModBridge } from "../src/mod-bridge.js";
import { ProfilesController, ProfilesStore } from "../src/profiles.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const accion1: Accion = {
  id: "a1",
  nombre: "Atacar",
  descripcion: "",
  duracionSeg: 0,
  puntos: 0,
  pantalla: null,
  media: { animacion: false, imagen: false, sonido: false, video: false },
  comandos: [{ modActionId: "arena_join", params: { character: "default" } }],
  repetirConComboDeRegalos: false,
};

const evento1: Evento = {
  id: "e1",
  activo: true,
  quien: "todos",
  porque: "seguir",
  modoDisparo: "todas",
  accionesIds: ["a1"],
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

  it("arranque fresco sin archivos → un perfil 'Predeterminado' vacío activo", () => {
    const { profilesPath, legacyPath } = tmpDir();
    const file = new ProfilesStore(profilesPath, legacyPath).load();

    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].name).toBe("Predeterminado");
    expect(file.profiles[0].acciones).toEqual([]);
    expect(file.profiles[0].eventos).toEqual([]);
    expect(file.activeProfileId).toBe(file.profiles[0].id);
  });

  it("profiles.json corrupto → cae al default y avisa", () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(profilesPath, "{no es json");
    const warnings: string[] = [];
    const file = new ProfilesStore(profilesPath, legacyPath, (m) => warnings.push(m)).load();

    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].acciones).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("round-trip: guardar y releer con otra instancia", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    const file: ProfilesFile = {
      profiles: [
        { id: "p1", name: "Uno", acciones: [accion1], eventos: [evento1] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
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

  /** Conecta una UI y drena los mensajes iniciales (acciones + eventos + profiles). */
  async function connectUI(port: number): Promise<{ ws: WebSocket; initialState: any }> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const initialAcciones = once(ws, "acciones");
    const initialEventos = once(ws, "eventos");
    const initialState = once(ws, "profiles");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await initialAcciones;
    await initialEventos;
    const state = await initialState;
    return { ws, initialState: state };
  }

  function seed(profilesPath: string, file: ProfilesFile) {
    writeFileSync(profilesPath, JSON.stringify(file));
  }

  it("carga las acciones/eventos del perfil activo en el motor al arrancar", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [accion1], eventos: [evento1] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });

    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);

    expect(engine.getAcciones()).toEqual([accion1]);
    expect(engine.getEventos()).toEqual([evento1]);
  });

  it("set-active cambia las acciones/eventos que usa el motor", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [accion1], eventos: [evento1] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "set-active", id: "p2" } }));
    const st = await stateAfter;
    expect(engine.getAcciones()).toEqual([]);
    expect(engine.getEventos()).toEqual([]);
    expect(st.activeProfileId).toBe("p2");

    ws.close();
  });

  it("crea un perfil vacío", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new AccionesEventosEngine(new ModBridge(server)), () => null);
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

  it("get-state responde con el estado actual (snapshot bajo demanda)", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [], eventos: [] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new AccionesEventosEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "get-state" } }));
    const st = await stateAfter;
    expect(st.kind).toBe("state");
    expect(st.profiles).toHaveLength(2);
    expect(st.activeProfileId).toBe("p1");

    ws.close();
  });

  it("duplica un perfil copiando sus acciones y eventos", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [accion1], eventos: [evento1] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new AccionesEventosEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "duplicate", id: "p1" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(3);
    const copy = st.profiles.find((p: any) => p.id !== "p1" && p.id !== "p2");
    expect(copy.eventoCount).toBe(1);

    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === copy.id)?.eventos).toEqual([evento1]);

    ws.close();
  });

  it("borra un perfil no activo", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [], eventos: [] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new AccionesEventosEngine(new ModBridge(server)), () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "delete", id: "p2" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(1);
    expect(st.profiles[0].id).toBe("p1");

    ws.close();
  });

  it("borrar el perfil activo reasigna el activo y cambia el motor", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    seed(profilesPath, {
      profiles: [
        { id: "p1", name: "Uno", acciones: [accion1], eventos: [evento1] },
        { id: "p2", name: "Dos", acciones: [], eventos: [] },
      ],
      activeProfileId: "p1",
    });
    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const stateAfter = once(ws, "profiles");
    ws.send(JSON.stringify({ channel: "profiles", payload: { kind: "delete", id: "p1" } }));
    const st = await stateAfter;
    expect(st.profiles).toHaveLength(1);
    expect(st.activeProfileId).toBe("p2");
    expect(engine.getAcciones()).toEqual([]);
    expect(engine.getEventos()).toEqual([]);

    ws.close();
  });

  it("rechaza borrar el último perfil", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), new AccionesEventosEngine(new ModBridge(server)), () => null);
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

  it("acciones set guarda en el perfil activo y lo persiste", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const update = once(ws, "acciones");
    ws.send(JSON.stringify({ channel: "acciones", payload: { kind: "set", acciones: [accion1] } }));
    const payload = await update;
    expect(payload).toEqual({ kind: "update", acciones: [accion1] });
    expect(engine.getAcciones()).toEqual([accion1]);

    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === onDisk.activeProfileId)?.acciones).toEqual([accion1]);

    ws.close();
  });

  it("eventos set guarda en el perfil activo y lo persiste", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => null);
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const update = once(ws, "eventos");
    ws.send(JSON.stringify({ channel: "eventos", payload: { kind: "set", eventos: [evento1] } }));
    const payload = await update;
    expect(payload).toEqual({ kind: "update", eventos: [evento1] });
    expect(engine.getEventos()).toEqual([evento1]);

    const onDisk = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesFile;
    expect(onDisk.profiles.find((p) => p.id === onDisk.activeProfileId)?.eventos).toEqual([evento1]);

    ws.close();
  });

  it("rechaza un set de acciones con comando inexistente en el catálogo", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    server = new StreamTokWsServer(0);
    const engine = new AccionesEventosEngine(new ModBridge(server));
    // catálogo con una sola acción; "no_existe" debe rechazarse
    new ProfilesController(server, new ProfilesStore(profilesPath, legacyPath), engine, () => ({
      mod: "gtav-chaos",
      version: "0.9.0",
      actions: [
        {
          id: "arena_join",
          name: "Arena",
          category: "arena",
          icon: "arena",
          description: "",
          supportsNameTag: true,
          params: [],
        },
      ],
    }));
    const port = await waitListening();
    const { ws } = await connectUI(port);

    const errPromise = once(ws, "acciones");
    ws.send(
      JSON.stringify({
        channel: "acciones",
        payload: { kind: "set", acciones: [{ ...accion1, comandos: [{ modActionId: "no_existe", params: {} }] }] },
      }),
    );
    const resp = await errPromise;
    expect(resp.kind).toBe("error");
    expect(resp.message).toMatch(/no_existe/);

    ws.close();
  });
});
