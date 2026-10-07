import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
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

/** Conecta y devuelve tanto el socket como una promesa de "primer mensaje
 * de este canal", con el listener adjuntado ANTES de esperar "open" —
 * necesario porque el servidor puede mandar datos en el mismo tick en que
 * la conexión se abre (ej. el reenvío de catálogo a un cliente que llega
 * tarde), y adjuntar el listener después de "open" puede perder ese
 * mensaje si "open" y "message" se emiten sincrónicamente uno tras otro. */
function connectAndCapture(port: number, channel: string): { ws: WebSocket; firstMessage: Promise<any> } {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const firstMessage = once(ws, channel);
  return { ws, firstMessage };
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
      params: [],
    },
  ],
};

describe("ModBridge (protocolo v0.9.0)", () => {
  let server: StreamTokWsServer;
  let modBridge: ModBridge;

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    modBridge = new ModBridge(server);
  });

  afterEach(() => {
    server.close();
  });

  async function waitListening(): Promise<number> {
    // server.actualPort ya puede estar disponible si "listening" se disparó
    // antes de que este helper corra (evita una carrera con beforeEach).
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  it("cachea el catálogo del mod-hello y lo reenvía a clientes que se conectan después", async () => {
    const port = await waitListening();
    const modWs = await connect(port);

    modWs.send(JSON.stringify({ channel: "mod-hello", payload: fakeCatalog }));
    await new Promise((r) => setTimeout(r, 50)); // deja que el server procese el hello

    // cliente "UI" se conecta DESPUÉS del mod-hello. El server puede
    // mandarle el catálogo cacheado en el mismo tick del "open", así que
    // capturamos el primer mensaje ANTES de esperar la conexión.
    const { ws: uiWs, firstMessage } = connectAndCapture(port, "mod-hello");
    const catalog = await firstMessage;

    expect(catalog.mod).toBe("gtav-chaos");
    expect(modBridge.getCatalog()?.actions).toHaveLength(2);

    modWs.close();
    uiWs.close();
  });

  it("acepta el catálogo del modo Carrera (category race)", async () => {
    const port = await waitListening();
    const modWs = await connect(port);
    modWs.send(
      JSON.stringify({
        channel: "mod-hello",
        payload: {
          ...fakeCatalog,
          actions: [
            ...fakeCatalog.actions,
            { id: "race_join", name: "Unirse a la carrera", category: "race", icon: "race", description: "Entra a la carrera", supportsNameTag: true, params: [] },
          ],
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(modBridge.getCatalog()?.actions).toHaveLength(3);
    expect(modBridge.getAction("race_join")?.category).toBe("race");
    modWs.close();
  });

  it("una categoría desconocida cae en other sin rechazar todo el mod-hello", async () => {
    const port = await waitListening();
    const modWs = await connect(port);
    modWs.send(
      JSON.stringify({
        channel: "mod-hello",
        payload: {
          ...fakeCatalog,
          actions: [
            ...fakeCatalog.actions,
            { id: "futuro_x", name: "Algo nuevo", category: "categoria-del-futuro", icon: "x", description: "", supportsNameTag: false, params: [] },
          ],
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(modBridge.getCatalog()?.actions).toHaveLength(3);
    expect(modBridge.getAction("futuro_x")?.category).toBe("other");
    expect(modBridge.getAction("arena_join")?.category).toBe("arena");
    modWs.close();
  });

  it("sendCommand devuelve ok:false sin bloquear si no hay mod conectado", async () => {
    await waitListening();
    const ack = await modBridge.sendCommand("arena_join", {});
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/no conectado/i);
  });
});
