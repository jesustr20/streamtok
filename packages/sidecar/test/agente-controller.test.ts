import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentConfigSchema } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";
import { AgenteController } from "../src/agente-controller.js";
import { TriviaEngine } from "../src/agente-trivia.js";
import { ModelService, type FetchLike } from "../src/agente-model.js";
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

  it("claves: se guardan, nunca se devuelven y «Probar conexión» responde", async () => {
    const saved: any[] = [];
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) });
    const model = new ModelService({ keys: { load: () => ({ keys: {} }), save: async (d) => void saved.push(d) }, fetchImpl });
    const srv = new StreamTokWsServer(0);
    const eng = new AgenteEngine({ store: { load: () => ({ config: AgentConfigSchema.parse({}) }), save: async () => {} } });
    new AgenteController(srv, eng, model);
    const c = await connect(srv);
    sockets.push(c.ws);
    const first = await c.next(isState);
    expect(first.payload.keys).toEqual({ deepseek: false, openai: false, gemini: false, claude: false });
    c.send({ kind: "set-key", provider: "deepseek", key: "sk-secreta-123456" });
    const withKey = await c.next((x) => isState(x) && x.payload.keys.deepseek === true);
    expect(JSON.stringify(withKey)).not.toContain("sk-secreta-123456");
    c.send({ kind: "test-connection", provider: "deepseek" });
    const r = await c.next((x) => x.channel === "agente" && x.payload.kind === "test-result");
    expect(r.payload).toMatchObject({ provider: "deepseek", ok: true });
    c.send({ kind: "remove-key", provider: "deepseek" });
    await c.next((x) => isState(x) && x.payload.keys.deepseek === false);
    srv.close();
  });

  it("trivia: se lanza de ejemplo, no filtra la respuesta correcta y se cancela", async () => {
    const srv = new StreamTokWsServer(0);
    const eng = new AgenteEngine({ store: { load: () => ({ config: AgentConfigSchema.parse({}) }), save: async () => {} } });
    const tri = new TriviaEngine({ generator: async () => null, getConfig: () => eng.getConfig() });
    new AgenteController(srv, eng, undefined, tri);
    const c = await connect(srv);
    sockets.push(c.ws);
    const first = await c.next(isState);
    expect(first.payload.trivia.phase).toBe("idle");
    c.send({ kind: "trivia-start", sample: true });
    const open = await c.next((x) => isState(x) && x.payload.trivia.phase === "open");
    expect(open.payload.trivia.options).toHaveLength(4);
    expect(JSON.stringify(open.payload.trivia)).not.toContain("correct");
    c.send({ kind: "trivia-start", sample: true });
    await c.next(isError);
    c.send({ kind: "trivia-cancel" });
    await c.next((x) => isState(x) && x.payload.trivia.phase === "idle");
    srv.close();
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
