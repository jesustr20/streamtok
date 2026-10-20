import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { TOP_PRESETS, type LiveEvent } from "@streamtok/shared";
import { TopsEngine } from "../src/tops.js";
import { TopsController } from "../src/tops-controller.js";
import { StreamTokWsServer } from "../src/ws-server.js";

type Msg = { channel: string; payload: any };

async function connect(server: StreamTokWsServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
  const inbox: Msg[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "tops", payload }));
  const next = async (pred: (m: Msg) => boolean, ms = 1500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = inbox.findIndex(pred);
      if (i !== -1) return inbox.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timeout esperando mensaje");
  };
  return { ws, send, next, inbox };
}

const gift = (e: Partial<LiveEvent> = {}): LiveEvent => ({
  event: "gift",
  username: "@ana",
  nickname: "Ana",
  giftName: "Rose",
  coins: 1,
  repeatEnd: true,
  timestamp: 1,
  ...e,
});

describe("TopsController", () => {
  let server: StreamTokWsServer;
  let engine: TopsEngine;
  const sockets: WebSocket[] = [];
  const isState = (m: Msg) => m.channel === "tops" && m.payload.kind === "state";
  const isError = (m: Msg) => m.channel === "tops" && m.payload.kind === "error";

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    engine = new TopsEngine({
      presets: TOP_PRESETS,
      store: { load: () => ({ configs: [], seededIds: [], runtime: {} }), save: async () => {} },
    });
    new TopsController(server, engine);
  });
  afterEach(() => {
    for (const s of sockets) s.close();
    server.close();
  });

  it("manda la configuración y el ranking al conectarse", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    const m = await c.next(isState);
    expect(m.payload.configs.map((x: any) => x.id)).toEqual(["gifters", "gifters-dia", "likes", "comentarios", "compartidos", "trivia"]);
    expect(m.payload.states[0].entries).toEqual([]);
  });

  it("un regalo reparte el ranking a todos; test, reset y save también", async () => {
    const a = await connect(server);
    const b = await connect(server);
    sockets.push(a.ws, b.ws);
    await a.next(isState);
    await b.next(isState);

    engine.handleLiveEvent(gift({ coins: 30 }));
    expect((await b.next(isState)).payload.states[0].entries[0]).toMatchObject({ name: "Ana", score: 30 });

    await new Promise((r) => setTimeout(r, 200)); // pasa el límite de envíos
    a.send({ kind: "test", id: "gifters", name: "Luna", amount: 50 });
    expect((await b.next(isState)).payload.states[0].entries[0]).toMatchObject({ name: "Luna", score: 50 });

    await new Promise((r) => setTimeout(r, 200));
    a.send({ kind: "reset", id: "gifters" });
    expect((await b.next(isState)).payload.states[0].entries).toEqual([]);

    await new Promise((r) => setTimeout(r, 200));
    a.send({ kind: "save", config: { ...engine.getConfigs()[0], title: "Cambiado" } });
    expect((await b.next(isState)).payload.configs[0].title).toBe("Cambiado");
  });

  it("muchos cambios seguidos se juntan en pocos envíos", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    for (let i = 0; i < 50; i++) engine.handleLiveEvent(gift({ username: `@u${i}`, nickname: `U${i}` }));
    await new Promise((r) => setTimeout(r, 400));
    const states = c.inbox.filter(isState);
    expect(states.length).toBeLessThanOrEqual(3);
    expect(states[states.length - 1].payload.states[0].entries).toHaveLength(5);
  });

  it("una configuración inválida devuelve error", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "save", config: { id: "Mala Id" } });
    expect((await c.next(isError)).payload.message).toMatch(/id/);
  });
});
