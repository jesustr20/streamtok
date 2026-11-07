import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { EmoteCatalogEntry } from "@streamtok/shared";
import { EmoteCatalogController, EmoteCatalogStore } from "../src/emote-catalog.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const sticker: EmoteCatalogEntry = {
  id: "s1",
  scene: "fanClub",
  imageUrl: "https://cdn/s1.png",
  count: 1,
  sceneCode: 2,
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

describe("EmoteCatalog (ADR 0018)", () => {
  let dir = "";
  let server: StreamTokWsServer | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const tmpPath = () => {
    dir = mkdtempSync(join(tmpdir(), "streamtok-emotes-"));
    return join(dir, "emote-catalog.json");
  };

  it("sin archivo o con archivo roto arranca vacío (y avisa del roto)", () => {
    const path = tmpPath();
    const warns: string[] = [];
    expect(new EmoteCatalogStore(path, (m) => warns.push(m)).load()).toEqual([]);
    writeFileSync(path, "{no es json", "utf8");
    expect(new EmoteCatalogStore(path, (m) => warns.push(m)).load()).toEqual([]);
    writeFileSync(path, JSON.stringify([{ id: 5 }]), "utf8");
    expect(new EmoteCatalogStore(path, (m) => warns.push(m)).load()).toEqual([]);
    expect(warns).toHaveLength(2);
  });

  it("aprende un sticker nuevo, lo guarda y avisa en el log con el código de TikTok", async () => {
    const path = tmpPath();
    server = new StreamTokWsServer(0);
    const controller = new EmoteCatalogController(server, new EmoteCatalogStore(path));
    const logs: string[] = [];
    controller.on("log", (l) => logs.push(l.message));

    expect(controller.learn(sticker)).toBe(true);
    expect(controller.getEntries()).toEqual([sticker]);
    expect(logs.join("\n")).toMatch(/aprendido: s1 \(Club de fans; código de TikTok 2\)/);
    await vi.waitFor(() => expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([sticker]));
  });

  it("si el id ya existe no hace nada (sin contar ni avisar); solo refresca la imagen si cambió", () => {
    server = new StreamTokWsServer(0);
    const controller = new EmoteCatalogController(server, new EmoteCatalogStore(tmpPath()));
    controller.learn(sticker);

    expect(controller.learn({ ...sticker })).toBe(false);
    expect(controller.learn({ ...sticker })).toBe(false);
    expect(controller.getEntries()).toEqual([sticker]);
    expect(controller.getEntries()).toHaveLength(1);

    expect(controller.learn({ ...sticker, imageUrl: "https://cdn/nueva.png" })).toBe(true);
    expect(controller.getEntries()).toHaveLength(1);
    expect(controller.getEntries()[0]).toMatchObject({ count: 1, imageUrl: "https://cdn/nueva.png" });
  });

  it("si un mensaje no trae imagen, conserva la que ya tenía; si cambia el origen, lo actualiza", () => {
    server = new StreamTokWsServer(0);
    const controller = new EmoteCatalogController(server, new EmoteCatalogStore(tmpPath()));
    controller.learn(sticker);
    controller.learn({ id: "s1", scene: "subscriber", count: 1 });
    expect(controller.getEntries()[0]).toMatchObject({ scene: "subscriber", imageUrl: "https://cdn/s1.png" });
  });

  it("entrega el catálogo por el canal emote-catalog al conectar y a pedido", async () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify([sticker]), "utf8");
    server = new StreamTokWsServer(0);
    new EmoteCatalogController(server, new EmoteCatalogStore(path));
    const port = server.actualPort || (await new Promise<number>((resolve) => server!.on("listening", (p) => resolve(p))));
    const ws = new WebSocket(`ws://localhost:${port}`);
    const first = once(ws, "emote-catalog");
    await new Promise((r) => ws.once("open", r));
    expect(await first).toEqual({ kind: "state", emotes: [sticker] });

    const again = once(ws, "emote-catalog");
    ws.send(JSON.stringify({ channel: "emote-catalog", payload: { kind: "get-state" } }));
    expect(await again).toEqual({ kind: "state", emotes: [sticker] });
    ws.close();
  });
});
