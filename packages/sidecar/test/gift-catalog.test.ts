import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { GiftCatalogEntry } from "@streamtok/shared";
import { GiftCatalogController, GiftCatalogStore } from "../src/gift-catalog.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const rose: GiftCatalogEntry = { id: "5655", name: "Rose", imageUrl: "https://cdn/rose.png", cost: 1 };
const heart: GiftCatalogEntry = {
  id: "5487",
  name: "Finger Heart",
  imageUrl: "https://cdn/finger.png",
  cost: 5,
};

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

describe("GiftCatalogStore", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpPath(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-gifts-"));
    return join(dir, "gift-catalog.json");
  }

  it("arranque sin archivo → catálogo vacío", () => {
    expect(new GiftCatalogStore(tmpPath()).load()).toEqual([]);
  });

  it("round-trip: guardar y releer con otra instancia", async () => {
    const path = tmpPath();
    await new GiftCatalogStore(path).save([rose, heart]);
    expect(new GiftCatalogStore(path).load()).toEqual([rose, heart]);
  });

  it("JSON corrupto → catálogo vacío y avisa", () => {
    const path = tmpPath();
    writeFileSync(path, "{no es json");
    const warnings: string[] = [];
    expect(new GiftCatalogStore(path, (m) => warnings.push(m)).load()).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("GiftCatalogController", () => {
  let server: StreamTokWsServer;
  let dir: string;

  afterEach(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpPath(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-gifts-ctrl-"));
    return join(dir, "gift-catalog.json");
  }

  async function waitListening(): Promise<number> {
    if (server.actualPort) return server.actualPort;
    return new Promise((resolve) => server.on("listening", (port) => resolve(port)));
  }

  /** Conecta y captura el estado inicial (snapshot de conexión). */
  async function connectAndCapture(port: number): Promise<{ ws: WebSocket; initialState: any }> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const firstMessage = once(ws, "gift-catalog");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return { ws, initialState: await firstMessage };
  }

  it("get-state responde el catálogo actual (snapshot bajo demanda)", async () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify([rose]));
    server = new StreamTokWsServer(0);
    new GiftCatalogController(server, new GiftCatalogStore(path));
    const port = await waitListening();
    const { ws, initialState } = await connectAndCapture(port);
    expect(initialState.gifts).toEqual([rose]);

    const stateAfter = once(ws, "gift-catalog");
    ws.send(JSON.stringify({ channel: "gift-catalog", payload: { kind: "get-state" } }));
    const st = await stateAfter;
    expect(st.gifts).toEqual([rose]);

    ws.close();
  });

  it("learn agrega (dedupe por id), emite state y persiste en disco", async () => {
    const path = tmpPath();
    server = new StreamTokWsServer(0);
    const controller = new GiftCatalogController(server, new GiftCatalogStore(path));
    const port = await waitListening();
    const { ws } = await connectAndCapture(port);

    // 1er regalo: nuevo → agrega + emite state
    const afterHeart = once(ws, "gift-catalog");
    expect(controller.learn(heart)).toBe(true);
    const st1 = await afterHeart;
    expect(st1.gifts).toEqual([heart]);

    // duplicado: no agrega, no emite
    expect(controller.learn(heart)).toBe(false);
    expect(controller.getEntries()).toEqual([heart]);

    // 2do regalo: nuevo → agrega + emite state
    const afterRose = once(ws, "gift-catalog");
    expect(controller.learn(rose)).toBe(true);
    const st2 = await afterRose;
    expect(st2.gifts).toEqual([heart, rose]);

    // persistido en disco (el save es fire-and-forget: esperamos un tick)
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([heart, rose]);

    ws.close();
  });
});
