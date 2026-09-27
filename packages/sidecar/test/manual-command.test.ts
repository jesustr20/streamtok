import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { registerManualCommand } from "../src/manual-command.js";
import { ModBridge } from "../src/mod-bridge.js";
import { StreamTokWsServer } from "../src/ws-server.js";

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
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

const fakeCatalog = {
  mod: "gtav-chaos",
  version: "0.9.0",
  actions: [
    {
      id: "arena_join",
      name: "Unirse a la arena",
      category: "arena" as const,
      icon: "arena",
      description: "El viewer entra a la pelea",
      supportsNameTag: true,
      params: [],
    },
    {
      id: "vehicle_spawn_random",
      name: "Aparecer vehículo",
      category: "vehicle" as const,
      icon: "vehicle",
      description: "Aparece un vehículo",
      supportsNameTag: false,
      params: [{ name: "amount", type: "int" as const, default: 1 }],
    },
  ],
};

describe("canal manual-command", () => {
  let server: StreamTokWsServer;
  let modBridge: ModBridge;

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    modBridge = new ModBridge(server);
    registerManualCommand(server, modBridge);
  });

  afterEach(() => {
    server.close();
  });

  async function waitListening(): Promise<number> {
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  it("envía el comando con los argumentos correctos y reenvía el ack", async () => {
    const port = await waitListening();

    const modWs = await connect(port);
    modWs.send(JSON.stringify({ channel: "mod-hello", payload: fakeCatalog }));
    await new Promise((r) => setTimeout(r, 50));

    const uiWs = await connect(port);

    const commandSeen = new Promise<any>((resolve) => {
      modWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.channel === "mod-command") resolve(msg.payload);
      });
    });

    const responsePromise = once(uiWs, "manual-command");
    uiWs.send(
      JSON.stringify({
        channel: "manual-command",
        payload: { action: "vehicle_spawn_random", params: { amount: 3 }, nameTag: "Fan" },
      }),
    );

    const command = await commandSeen;
    expect(command.action).toBe("vehicle_spawn_random");
    expect(command.params).toEqual({ amount: 3 });
    expect(command.nameTag).toBe("Fan");

    modWs.send(JSON.stringify({ channel: "mod-ack", payload: { id: command.id, ok: true } }));

    const resp = await responsePromise;
    expect(resp).toEqual({ kind: "ack", ack: { id: command.id, ok: true } });

    modWs.close();
    uiWs.close();
  });

  it("rechaza un payload inválido y nunca llama a sendCommand", async () => {
    const port = await waitListening();
    const spy = vi.spyOn(modBridge, "sendCommand");
    const uiWs = await connect(port);

    // action faltante
    const r1 = once(uiWs, "manual-command");
    uiWs.send(JSON.stringify({ channel: "manual-command", payload: { params: {} } }));
    const resp1 = await r1;
    expect(resp1.kind).toBe("error");
    expect(resp1.message).toMatch(/action/);

    // params malformados (string en vez de objeto)
    const r2 = once(uiWs, "manual-command");
    uiWs.send(JSON.stringify({ channel: "manual-command", payload: { action: "x", params: "no" } }));
    const resp2 = await r2;
    expect(resp2.kind).toBe("error");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    uiWs.close();
  });

  it("sin mod conectado reenvía el error 'no conectado' de sendCommand", async () => {
    const port = await waitListening();
    const uiWs = await connect(port);

    const responsePromise = once(uiWs, "manual-command");
    uiWs.send(
      JSON.stringify({ channel: "manual-command", payload: { action: "arena_join", params: {} } }),
    );

    const resp = await responsePromise;
    expect(resp.kind).toBe("ack");
    expect(resp.ack.ok).toBe(false);
    expect(resp.ack.error).toMatch(/no conectado/i);

    uiWs.close();
  });
});
