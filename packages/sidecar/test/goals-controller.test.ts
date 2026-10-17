import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { GoalsEngine } from "../src/goals.js";
import { GoalsController } from "../src/goals-controller.js";
import { StreamTokWsServer } from "../src/ws-server.js";

type Msg = { channel: string; payload: any };

async function connect(server: StreamTokWsServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
  const inbox: Msg[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "goals", payload }));
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

describe("GoalsController", () => {
  let server: StreamTokWsServer;
  let engine: GoalsEngine;
  const sockets: WebSocket[] = [];
  const isState = (m: Msg) => m.channel === "goals" && m.payload.kind === "state";
  const isError = (m: Msg) => m.channel === "goals" && m.payload.kind === "error";

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    engine = new GoalsEngine({ store: { load: () => ({ goals: [], seeded: true, seededIds: [] }), save: async () => {} } });
    new GoalsController(server, engine);
  });
  afterEach(() => {
    for (const s of sockets) s.close();
    server.close();
  });

  it("manda las metas al conectarse", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    const m = await c.next(isState);
    expect(m.payload.goals).toEqual([]);
    expect(typeof m.payload.serverNow).toBe("number");
  });

  it("save crea la meta y lo reparte a todos; goal-control suma; remove borra", async () => {
    const a = await connect(server);
    const b = await connect(server);
    sockets.push(a.ws, b.ws);
    await a.next(isState);
    await b.next(isState);
    a.send({ kind: "save", config: { id: "likes", metric: "likes", target: 500 } });
    const created = await b.next(isState);
    expect(created.payload.goals[0].config.id).toBe("likes");
    expect(created.payload.goals[0].state.target).toBe(500);
    a.send({ kind: "goal-control", id: "likes", op: "add", value: 25 });
    expect((await b.next(isState)).payload.goals[0].state.current).toBe(25);
    a.send({ kind: "remove", id: "likes" });
    expect((await b.next(isState)).payload.goals).toEqual([]);
  });

  it("una configuración inválida o una meta inexistente devuelven error", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "save", config: { id: "Mala Id", target: 10 } });
    expect((await c.next(isError)).payload.message).toMatch(/id/);
    c.send({ kind: "goal-control", id: "nada", op: "add", value: 1 });
    expect((await c.next(isError)).payload.message).toMatch(/nada/);
  });
});
