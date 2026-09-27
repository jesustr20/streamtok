import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ModHelloPayload, MappingRule } from "@streamtok/shared";
import { MappingEngine } from "../src/mapping.js";
import {
  MappingRulesController,
  MappingRulesStore,
  validateRules,
} from "../src/mapping-rules.js";
import { ModBridge } from "../src/mod-bridge.js";
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
    {
      id: "vehicle_spawn_random",
      name: "Aparecer vehículo",
      category: "vehicle",
      icon: "vehicle",
      description: "Aparece un vehículo",
      supportsNameTag: false,
      params: [{ name: "amount", type: "int", default: 1 }],
    },
  ],
};

const validRule: MappingRule = {
  id: "r1",
  when: { event: "gift", giftId: 5655 },
  action: "arena_join",
  params: { character: "default", coins: 0 },
  passCoinsAsParam: "coins",
};

describe("validateRules", () => {
  it("acepta una regla válida contra el catálogo", () => {
    const result = validateRules([validRule], catalog);
    expect(result.ok).toBe(true);
  });

  it("rechaza una acción inexistente", () => {
    const result = validateRules([{ ...validRule, action: "no_existe" }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/no_existe/);
  });

  it("rechaza un parámetro que la acción no define", () => {
    const result = validateRules([{ ...validRule, params: { foo: 1 } }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/foo/);
  });

  it("rechaza un valor de parámetro de tipo incompatible", () => {
    const rule: MappingRule = {
      id: "r2",
      when: { event: "comment", command: "!carro" },
      action: "vehicle_spawn_random",
      params: { amount: "muchos" },
    };
    const result = validateRules([rule], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/amount/);
  });

  it("rechaza passCoinsAsParam que no es un parámetro de la acción", () => {
    const result = validateRules([{ ...validRule, passCoinsAsParam: "nope" }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/nope/);
  });

  it("rechaza command con un evento que no es comment", () => {
    const result = validateRules(
      [{ ...validRule, when: { event: "gift", command: "!carro" } }],
      catalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/command/);
  });

  it("sin catálogo valida solo la forma (permite reglas, rechaza basura)", () => {
    expect(validateRules([validRule], null).ok).toBe(true);
    expect(validateRules([{ id: 123 }], null).ok).toBe(false);
    expect(validateRules("basura", null).ok).toBe(false);
  });
});

describe("MappingRulesStore", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpFile(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-rules-"));
    return join(dir, "mapping-rules.json");
  }

  it("carga [] si el archivo no existe (primer arranque)", () => {
    const store = new MappingRulesStore(tmpFile());
    expect(store.load()).toEqual([]);
  });

  it("carga [] si el archivo está vacío", () => {
    const file = tmpFile();
    writeFileSync(file, "");
    expect(new MappingRulesStore(file).load()).toEqual([]);
  });

  it("carga [] y avisa si el archivo es JSON corrupto", () => {
    const file = tmpFile();
    writeFileSync(file, "{no es json");
    const warnings: string[] = [];
    const store = new MappingRulesStore(file, (m) => warnings.push(m));
    expect(store.load()).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("persiste las reglas: guardar y releer con otra instancia", async () => {
    const file = tmpFile();
    await new MappingRulesStore(file).save([validRule]);
    expect(new MappingRulesStore(file).load()).toEqual([validRule]);
  });

  it("borrar una regla actualiza el estado persistido", async () => {
    const file = tmpFile();
    const other: MappingRule = {
      id: "r2",
      when: { event: "comment", command: "!carro" },
      action: "vehicle_spawn_random",
      params: { amount: 1 },
    };
    await new MappingRulesStore(file).save([validRule, other]);
    await new MappingRulesStore(file).save([validRule]);
    expect(new MappingRulesStore(file).load()).toEqual([validRule]);
  });
});

describe("MappingRulesController", () => {
  let server: StreamTokWsServer;
  let dir: string;

  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpFile(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-rules-ctrl-"));
    return join(dir, "mapping-rules.json");
  }

  async function waitListening(): Promise<number> {
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  function onceMappingRules(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.on("message", function handler(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.channel === "mapping-rules") {
          ws.off("message", handler);
          resolve(msg.payload);
        }
      });
    });
  }

  it("carga las reglas persistidas en el MappingEngine al arrancar", async () => {
    const file = tmpFile();
    await new MappingRulesStore(file).save([validRule]);

    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new MappingRulesController(server, new MappingRulesStore(file), engine, () => null);

    expect(engine.getRules()).toEqual([validRule]);
  });

  it("un set válido persiste y se propaga por broadcast", async () => {
    const file = tmpFile();
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new MappingRulesController(server, new MappingRulesStore(file), engine, () => catalog);

    const port = await waitListening();
    const ws = new WebSocket(`ws://localhost:${port}`);
    const initial = onceMappingRules(ws);
    await new Promise((r) => ws.once("open", r));
    await initial; // update inicial (lista vacía) al conectar

    const update = onceMappingRules(ws);
    ws.send(JSON.stringify({ channel: "mapping-rules", payload: { kind: "set", rules: [validRule] } }));

    const payload = await update;
    expect(payload).toEqual({ kind: "update", rules: [validRule] });
    expect(engine.getRules()).toEqual([validRule]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([validRule]);

    ws.close();
  });

  it("un set inválido se rechaza con error y no persiste ni carga en el engine", async () => {
    const file = tmpFile();
    server = new StreamTokWsServer(0);
    const engine = new MappingEngine(new ModBridge(server));
    new MappingRulesController(server, new MappingRulesStore(file), engine, () => catalog);

    const port = await waitListening();
    const ws = new WebSocket(`ws://localhost:${port}`);
    const initial = onceMappingRules(ws);
    await new Promise((r) => ws.once("open", r));
    await initial;

    const errorPromise = onceMappingRules(ws);
    ws.send(
      JSON.stringify({
        channel: "mapping-rules",
        payload: { kind: "set", rules: [{ ...validRule, action: "no_existe" }] },
      }),
    );

    const payload = await errorPromise;
    expect(payload.kind).toBe("error");
    expect(payload.message).toMatch(/no_existe/);
    expect(engine.getRules()).toEqual([]);
    expect(existsSync(file)).toBe(false);

    ws.close();
  });
});
