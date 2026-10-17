import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ALERT_PRESETS } from "@streamtok/shared";
import { AlertasEngine } from "../src/alertas.js";
import { AlertasController } from "../src/alertas-controller.js";
import { StreamTokWsServer } from "../src/ws-server.js";

type Msg = { channel: string; payload: any };

async function connect(server: StreamTokWsServer) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
  const inbox: Msg[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "alertas", payload }));
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

describe("AlertasController", () => {
  let server: StreamTokWsServer;
  let engine: AlertasEngine;
  const sockets: WebSocket[] = [];
  const isState = (m: Msg) => m.channel === "alertas" && m.payload.kind === "state";
  const isAlert = (m: Msg) => m.channel === "alertas" && m.payload.kind === "alert";
  const isError = (m: Msg) => m.channel === "alertas" && m.payload.kind === "error";

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    engine = new AlertasEngine({
      presets: ALERT_PRESETS,
      store: { load: () => ({ configs: [], seededIds: [], joinGiftNames: ["heart me"] }), save: async () => {} },
    });
    new AlertasController(server, engine);
  });
  afterEach(() => {
    for (const s of sockets) s.close();
    server.close();
  });

  it("manda la configuración al conectarse", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    const m = await c.next(isState);
    expect(m.payload.configs.map((x: any) => x.id)).toEqual(["comunidad", "donador", "todas"]);
    expect(m.payload.joinGiftNames).toEqual(["heart me"]);
  });

  it("test reparte un aviso a todos; save y set-join-gifts reparten el estado", async () => {
    const a = await connect(server);
    const b = await connect(server);
    sockets.push(a.ws, b.ws);
    await a.next(isState);
    await b.next(isState);
    a.send({ kind: "test", alertKind: "fanJoin" });
    expect((await b.next(isAlert)).payload.alert.kind).toBe("fanJoin");
    a.send({ kind: "save", config: { ...ALERT_PRESETS[0], durationSec: 12 } });
    expect((await b.next(isState)).payload.configs[0].durationSec).toBe(12);
    a.send({ kind: "set-join-gifts", names: ["Corazón"] });
    expect((await b.next(isState)).payload.joinGiftNames).toEqual(["corazón"]);
  });

  it("una configuración inválida devuelve error", async () => {
    const c = await connect(server);
    sockets.push(c.ws);
    await c.next(isState);
    c.send({ kind: "save", config: { id: "Mala Id" } });
    expect((await c.next(isError)).payload.message).toMatch(/id/);
  });
});
