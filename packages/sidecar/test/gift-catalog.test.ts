import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { GiftCatalogEntry } from "@streamtok/shared";
import {
  GiftCatalogController,
  GiftCatalogStore,
  normalizeGiftName,
} from "../src/gift-catalog.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const rose: GiftCatalogEntry = { id: "5655", name: "Rose", imageUrl: "https://cdn/rose.png", cost: 1 };

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

describe("normalizeGiftName", () => {
  it("normaliza trim, mayúsculas y tildes", () => {
    expect(normalizeGiftName("  Corazón  ")).toBe("corazon");
    expect(normalizeGiftName("Finger Heart")).toBe("finger heart");
    expect(normalizeGiftName("ÁÉÍÓÚ")).toBe("aeiou");
    expect(normalizeGiftName("León")).toBe("leon");
  });
});

describe("GiftCatalogStore", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpPath(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-gifts-"));
    return join(dir, "gift-catalog.json");
  }

  it("arranque sin archivo → siembra desde el catálogo estático (sin id)", () => {
    const entries = new GiftCatalogStore(tmpPath()).load();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.id === undefined)).toBe(true);

    const finger = entries.find((e) => e.name === "Finger Heart");
    expect(finger).toMatchObject({ cost: 5, imageUrl: expect.stringContaining("beetgames.com") });

    const lion = entries.find((e) => e.name === "Lion");
    expect(lion).toMatchObject({ cost: 29999 });
  });

  it("no resembrar si ya existe gift-catalog.json", async () => {
    const path = tmpPath();
    writeFileSync(path, JSON.stringify([rose]));
    expect(new GiftCatalogStore(path).load()).toEqual([rose]);
  });

  it("round-trip: guardar y releer con otra instancia", async () => {
    const path = tmpPath();
    await new GiftCatalogStore(path).save([rose]);
    expect(new GiftCatalogStore(path).load()).toEqual([rose]);
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

  async function connectAndCapture(port: number): Promise<{ ws: WebSocket; initialState: any }> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const firstMessage = once(ws, "gift-catalog");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return { ws, initialState: await firstMessage };
  }

  function seed(path: string, entries: GiftCatalogEntry[]) {
    writeFileSync(path, JSON.stringify(entries));
  }

  it("get-state responde el catálogo actual", async () => {
    const path = tmpPath();
    seed(path, [rose]);
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

  it("match por id tiene prioridad sobre match por nombre", async () => {
    const path = tmpPath();
    seed(path, [{ id: "5487", name: "Finger Heart", imageUrl: "https://cdn/real.png", cost: 5 }]);
    server = new StreamTokWsServer(0);
    const controller = new GiftCatalogController(server, new GiftCatalogStore(path));

    // el evento real viene con el mismo id (aunque el nombre difiera en mayúsculas)
    const changed = controller.learn({
      id: "5487",
      name: "FINGER HEART",
      imageUrl: "https://cdn/otra.png",
      cost: 5,
    });

    expect(changed).toBe(false);
    expect(controller.getEntries()).toEqual([
      { id: "5487", name: "Finger Heart", imageUrl: "https://cdn/real.png", cost: 5 },
    ]);
  });

  it("upgrade de entrada sembrada (sin id) cuando llega evento real con nombre coincidente", async () => {
    const path = tmpPath();
    seed(path, [{ name: "Finger Heart", imageUrl: "https://beetgames.com/finger.webp", cost: 5 }]);
    server = new StreamTokWsServer(0);
    const controller = new GiftCatalogController(server, new GiftCatalogStore(path));

    const changed = controller.learn({
      id: "5487",
      name: "Finger Heart",
      imageUrl: "https://tiktokcdn.com/finger.png",
      cost: 5,
    });

    expect(changed).toBe(true);
    expect(controller.getEntries()).toEqual([
      { id: "5487", name: "Finger Heart", imageUrl: "https://tiktokcdn.com/finger.png", cost: 5 },
    ]);
  });

  it("matchea por nombre normalizado (mayúsculas/tildes)", async () => {
    const path = tmpPath();
    seed(path, [{ name: "Corazón", imageUrl: "https://beetgames.com/corazon.webp", cost: 1 }]);
    server = new StreamTokWsServer(0);
    const controller = new GiftCatalogController(server, new GiftCatalogStore(path));

    const changed = controller.learn({
      id: "100",
      name: "CORAZON",
      imageUrl: "https://tiktokcdn.com/corazon.png",
      cost: 1,
    });

    expect(changed).toBe(true);
    expect(controller.getEntries()[0]).toMatchObject({ id: "100", name: "Corazón" });
  });

  it("agrega entrada nueva si no hay match ni por id ni por nombre", async () => {
    const path = tmpPath();
    seed(path, [rose]);
    server = new StreamTokWsServer(0);
    const controller = new GiftCatalogController(server, new GiftCatalogStore(path));

    const changed = controller.learn({
      id: "9999",
      name: "Galaxy",
      imageUrl: "https://cdn/galaxy.png",
      cost: 100,
    });

    expect(changed).toBe(true);
    expect(controller.getEntries()).toEqual([
      rose,
      { id: "9999", name: "Galaxy", imageUrl: "https://cdn/galaxy.png", cost: 100 },
    ]);
  });

  it("persiste el upgrade en disco", async () => {
    const path = tmpPath();
    seed(path, [{ name: "Finger Heart", imageUrl: "https://beetgames.com/finger.webp", cost: 5 }]);
    server = new StreamTokWsServer(0);
    new GiftCatalogController(server, new GiftCatalogStore(path)).learn({
      id: "5487",
      name: "Finger Heart",
      imageUrl: "https://tiktokcdn.com/finger.png",
      cost: 5,
    });

    await new Promise((r) => setTimeout(r, 50));
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as GiftCatalogEntry[];
    expect(onDisk).toEqual([
      { id: "5487", name: "Finger Heart", imageUrl: "https://tiktokcdn.com/finger.png", cost: 5 },
    ]);
  });
});
