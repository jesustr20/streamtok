import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentConfigSchema } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";
import { AgenteController } from "../src/agente-controller.js";
import { StreamTokWsServer } from "../src/ws-server.js";

type Msg = { channel: string; payload: any };

async function connect(server: StreamTokWsServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
  const inbox: Msg[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "agente", payload }));
  const next = async (pred: (m: Msg) => boolean, ms = 1500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = inbox.findIndex(pred);
      if (i !== -1) return inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timeout esperando mensaje");
  };
  return { ws, send, next };
}

describe("AgenteController", () => {
  let server: StreamTokWsServer;
  let engine: AgenteEngine;
  const sockets: WebSocket[] = [];
  const isState = (m: Msg) => m.channel === "agente" && m.payload.kind === "state";
  const isError = (m: Msg) => m.channel === "agente" && m.payload.kind === "error";

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    engine = new AgenteEngine({ store: { load: () => ({ config: AgentConfigSchema.parse({}) }), save: async () => {} } });
    new AgenteController(server, engine);
  });
  afterEach(() => {
    for (const s of sockets) s.close();
    server.close();
  });

  it("manda la configuración y la cola al conectarse", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    const m = await c.next(isState);
    expect(m.payload.config.command).toBe("!ia");
    expect(m.payload.state.queueSize).toBe(0);
  });

  it("ask mete una pregunta de prueba y reset la quita", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "ask", name: "Ana", question: "¿hola?", coins: 20 });
    const m = await c.next((x) => isState(x) && x.payload.state.queueSize === 1);
    expect(m.payload.state.queue[0]).toMatchObject({ name: "Ana", coins: 20 });
    c.send({ kind: "reset" });
    await c.next((x) => isState(x) && x.payload.state.queueSize === 0);
  });

  it("save cambia la configuración y una inválida da error", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "save", config: AgentConfigSchema.parse({ name: "Luna" }) });
    await c.next((x) => isState(x) && x.payload.config.name === "Luna");
    c.send({ kind: "save", config: { name: "" } });
    await c.next(isError);
  });
});
