import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { TiktokConnectionState } from "@streamtok/shared";
import { TiktokConnectionController, type LiveSource } from "../src/tiktok-connection.js";
import { StreamTokWsServer } from "../src/ws-server.js";

class FakeSource extends EventEmitter implements LiveSource {
  started = false;
  stopped = false;
  failWith: Error | null = null;
  constructor(readonly username: string) {
    super();
  }
  async start() {
    if (this.failWith) throw this.failWith;
    this.started = true;
    this.emit("connected");
  }
  async stop() {
    this.stopped = true;
  }
}

class FakeRecorder {
  filePath: string;
  records: Array<[string, unknown]> = [];
  closed = false;
  constructor(username: string) {
    this.filePath = `/rec/live-${username}.jsonl`;
  }
  record(type: string, event: unknown) {
    this.records.push([type, event]);
  }
  async close() {
    this.closed = true;
  }
}

describe("TiktokConnectionController", () => {
  let server: StreamTokWsServer;
  let sources: FakeSource[];
  let recorders: FakeRecorder[];
  let onEvent: ReturnType<typeof vi.fn>;
  let onGift: ReturnType<typeof vi.fn>;
  let onConnected: ReturnType<typeof vi.fn>;
  let controller: TiktokConnectionController;
  let nextFail: Error | null;

  beforeEach(() => {
    server = new StreamTokWsServer(0);
    sources = [];
    recorders = [];
    nextFail = null;
    onEvent = vi.fn();
    onGift = vi.fn();
    onConnected = vi.fn();
    controller = new TiktokConnectionController(server, {
      createRecorder: (username) => {
        const r = new FakeRecorder(username);
        recorders.push(r);
        return r;
      },
      createSource: (username, recorder) => {
        const s = new FakeSource(username);
        s.failWith = nextFail;
        (s as any).recorder = recorder;
        sources.push(s);
        return s;
      },
      onEvent,
      onGift,
      onConnected,
    });
  });

  afterEach(async () => {
    await controller.disconnect();
    server.close();
  });

  it("empieza idle", () => {
    expect(controller.getState()).toEqual({ status: "idle", recordedEvents: 0 });
  });

  it("connect: quita @ y espacios, graba siempre y queda connected", async () => {
    await controller.connect("  @mi_live ");
    const state = controller.getState();
    expect(state).toMatchObject({
      status: "connected",
      username: "mi_live",
      recordingPath: "/rec/live-mi_live.jsonl",
      recordedEvents: 0,
    });
    expect(sources[0].started).toBe(true);
    (sources[0] as any).recorder.record("WebcastLikeMessage", { n: 1 });
    expect(recorders[0].records).toEqual([["WebcastLikeMessage", { n: 1 }]]);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("username vacío → error sin crear fuente", async () => {
    await controller.connect("  @ ");
    expect(controller.getState()).toMatchObject({ status: "error" });
    expect(controller.getState().error).toMatch(/usuario/i);
    expect(sources).toHaveLength(0);
  });

  it("reenvía eventos y regalos de la fuente", async () => {
    await controller.connect("x");
    sources[0].emit("event", { event: "like" });
    sources[0].emit("giftCatalogEntry", { name: "Rose", imageUrl: "u", cost: 1 });
    expect(onEvent).toHaveBeenCalledWith({ event: "like" });
    expect(onGift).toHaveBeenCalledWith({ name: "Rose", imageUrl: "u", cost: 1 });
  });

  it("cuenta los mensajes grabados", async () => {
    await controller.connect("x");
    const rec = (sources[0] as any).recorder;
    rec.record("WebcastLikeMessage", { a: 1 });
    rec.record("WebcastGiftMessage", { b: 2 });
    expect(controller.getState().recordedEvents).toBe(2);
    expect(recorders[0].records).toHaveLength(2);
  });

  it("falla al conectar: error con el motivo y cierra la grabación", async () => {
    nextFail = new Error("LIVE no disponible");
    await controller.connect("x");
    expect(controller.getState()).toMatchObject({ status: "error", username: "x", error: "LIVE no disponible" });
    expect(recorders[0].closed).toBe(true);
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("disconnect: detiene la fuente, cierra la grabación y vuelve a idle", async () => {
    await controller.connect("x");
    await controller.disconnect();
    expect(sources[0].stopped).toBe(true);
    expect(recorders[0].closed).toBe(true);
    expect(controller.getState()).toEqual({ status: "idle", recordedEvents: 0 });
  });

  it("connect estando conectado cierra la conexión anterior y graba en un archivo nuevo", async () => {
    await controller.connect("uno");
    await controller.connect("dos");
    expect(sources[0].stopped).toBe(true);
    expect(recorders[0].closed).toBe(true);
    expect(controller.getState()).toMatchObject({ status: "connected", username: "dos", recordedEvents: 0 });
    expect(recorders[1].filePath).toContain("dos");
  });

  it("si la fuente avisa un corte, pasa a error y cierra la grabación", async () => {
    await controller.connect("x");
    sources[0].emit("disconnected", "1006");
    expect(controller.getState()).toMatchObject({ status: "error", username: "x" });
    expect(controller.getState().error).toMatch(/cort/i);
    await vi.waitFor(() => expect(recorders[0].closed).toBe(true));
  });

  it("un evento tardío de una conexión vieja no pisa a la nueva", async () => {
    await controller.connect("uno");
    const old = sources[0];
    await controller.connect("dos");
    old.emit("disconnected", "1006");
    old.emit("event", { event: "like" });
    expect(controller.getState()).toMatchObject({ status: "connected", username: "dos" });
    expect(onEvent).not.toHaveBeenCalled();
  });

  describe("canal WS", () => {
    async function port(): Promise<number> {
      if (server.actualPort) return server.actualPort;
      return new Promise((r) => server.on("listening", (p) => r(p)));
    }
    /** Abre un cliente registrando los `state` desde el primer mensaje. */
    async function openCollecting(): Promise<{ ws: WebSocket; seen: TiktokConnectionState[] }> {
      const seen: TiktokConnectionState[] = [];
      const ws = new WebSocket(`ws://localhost:${await port()}`);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.channel === "tiktok-connection" && msg.payload.kind === "state") seen.push(msg.payload.state);
      });
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      return { ws, seen };
    }

    it("manda el estado al conectarse un cliente", async () => {
      const { ws, seen } = await openCollecting();
      await vi.waitFor(() => expect(seen[0]).toEqual({ status: "idle", recordedEvents: 0 }));
      ws.close();
    });

    it("connect/disconnect desde la UI", async () => {
      const { ws, seen } = await openCollecting();
      ws.send(JSON.stringify({ channel: "tiktok-connection", payload: { kind: "connect", username: "@abc" } }));
      await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ status: "connected", username: "abc" }));
      expect(seen.some((s) => s.status === "connecting")).toBe(true);
      ws.send(JSON.stringify({ channel: "tiktok-connection", payload: { kind: "disconnect" } }));
      await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ status: "idle" }));
      ws.close();
    });

    it("ignora payloads inválidos", async () => {
      const { ws } = await openCollecting();
      ws.send(JSON.stringify({ channel: "tiktok-connection", payload: { kind: "connect" } }));
      await new Promise((r) => setTimeout(r, 50));
      expect(sources).toHaveLength(0);
      ws.close();
    });
  });

  it("reenvía el conteo de grabados como mucho una vez por segundo", async () => {
    vi.useFakeTimers();
    try {
      const sent: TiktokConnectionState[] = [];
      const spy = vi.spyOn(server, "broadcast").mockImplementation(((_c: string, p: any) => {
        if (p.kind === "state") sent.push(p.state);
      }) as any);
      await controller.connect("x");
      const base = sent.length;
      const rec = (sources[0] as any).recorder;
      rec.record("a", {});
      rec.record("b", {});
      expect(sent.length).toBe(base); // aún no
      await vi.advanceTimersByTimeAsync(1100);
      expect(sent.length).toBe(base + 1);
      expect(sent.at(-1)?.recordedEvents).toBe(2);
      await vi.advanceTimersByTimeAsync(3000);
      expect(sent.length).toBe(base + 1); // sin cambios, sin broadcast
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
