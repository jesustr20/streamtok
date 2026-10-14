import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { OverlaysConfigSchema, type OverlaysConfig } from "@streamtok/shared";
import { OverlayCounters, type PersistedOverlays } from "../src/overlay-counters.js";
import { OverlaysController } from "../src/overlays-controller.js";
import { StreamTokWsServer } from "../src/ws-server.js";

function memoryStore() {
  return {
    load: (): PersistedOverlays => ({ config: OverlaysConfigSchema.parse({}) }),
    save: async () => {},
  };
}

async function connect(server: StreamTokWsServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
  const inbox: Array<{ channel: string; payload: any }> = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "overlays", payload }));
  const next = async (pred: (m: { channel: string; payload: any }) => boolean, ms = 1500) => {
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

describe("OverlaysController", () => {
  let server: StreamTokWsServer;
  let counters: OverlayCounters;
  const sockets: WebSocket[] = [];

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    counters = new OverlayCounters({ store: memoryStore() });
    new OverlaysController(server, counters);
  });
  afterEach(() => {
    counters.dispose();
    for (const s of sockets) s.close();
    server.close();
  });

  const isState = (m: { channel: string; payload: any }) => m.channel === "overlays" && m.payload.kind === "state";

  it("manda el estado y la configuración al conectarse", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    const msg = await c.next(isState);
    expect(msg.payload.state.timer.status).toBe("idle");
    expect(msg.payload.state.wins.goal).toBe(10);
    expect(msg.payload.config.timer.startSeconds).toBe(60);
  });

  it("get-state responde solo a quien lo pidió", async () => {
    const a = await connect(server);
    const b = await connect(server);
    sockets.push(a.ws, b.ws);
    await a.next(isState);
    await b.next(isState);
    a.send({ kind: "get-state" });
    await a.next(isState);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.inbox.filter(isState)).toHaveLength(0);
  });

  it("timer-control: los cambios se reparten a todos los clientes", async () => {
    const a = await connect(server);
    const b = await connect(server);
    sockets.push(a.ws, b.ws);
    await a.next(isState);
    await b.next(isState);
    a.send({ kind: "timer-control", op: "start" });
    const seen = await b.next(isState);
    expect(seen.payload.state.timer.status).toBe("running");
    a.send({ kind: "timer-control", op: "add", seconds: 30 });
    const added = await b.next(isState);
    expect(added.payload.state.timer.remainingMs).toBeGreaterThan(85_000);
  });

  it("timer-control add desde la UI es manual: funciona aunque el timer esté detenido", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "timer-control", op: "add", seconds: 15 });
    const m = await c.next(isState);
    expect(m.payload.state.timer.remainingMs).toBe(75_000);
  });

  it("wins-control: add, set, set-goal, set-title, reset", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "wins-control", op: "add", value: 2 });
    expect((await c.next(isState)).payload.state.wins.count).toBe(2);
    c.send({ kind: "wins-control", op: "set-goal", value: 6 });
    expect((await c.next(isState)).payload.state.wins.goal).toBe(6);
    c.send({ kind: "wins-control", op: "set-title", value: "Monte" });
    expect((await c.next(isState)).payload.state.wins.title).toBe("Monte");
    c.send({ kind: "wins-control", op: "set", value: 5 });
    expect((await c.next(isState)).payload.state.wins.count).toBe(5);
    c.send({ kind: "wins-control", op: "reset" });
    expect((await c.next(isState)).payload.state.wins.count).toBe(0);
  });

  it("set-config valida y se reparte; una configuración inválida devuelve error", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    const config: OverlaysConfig = OverlaysConfigSchema.parse({ timer: { startSeconds: 120 }, winsStyle: { designId: "streamtok" } });
    c.send({ kind: "set-config", config });
    const ok = await c.next(isState);
    expect(ok.payload.config.timer.startSeconds).toBe(120);
    expect(ok.payload.config.winsStyle.designId).toBe("streamtok");
    c.send({ kind: "set-config", config: { timer: { startSeconds: -5 } } });
    const err = await c.next((m) => m.channel === "overlays" && m.payload.kind === "error");
    expect(err.payload.message).toBeTruthy();
  });

  it("add sin segundos devuelve error y no cambia nada", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "timer-control", op: "add" });
    const err = await c.next((m) => m.channel === "overlays" && m.payload.kind === "error");
    expect(err.payload.message).toContain("seconds");
    expect(counters.getState().timer.remainingMs).toBe(60_000);
  });

  it("ignora mensajes que no entiende", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "basura" });
    c.send("hola");
    await new Promise((r) => setTimeout(r, 30));
    expect(counters.getState().wins.count).toBe(0);
  });
});
