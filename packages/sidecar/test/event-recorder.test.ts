import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventRecorder, maxBytesFromEnv } from "../src/event-recorder.js";
import { TikTokLiveSource } from "../src/tiktok-source.js";

describe("EventRecorder", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmp(): string {
    dir = mkdtempSync(join(tmpdir(), "streamtok-recorder-"));
    return dir;
  }

  function readLines(path: string): any[] {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  it("escribe una línea JSON por evento con timestamp, tipo y datos completos", async () => {
    const rec = new EventRecorder({ dir: tmp(), label: "streamer", now: () => 1000 });
    rec.record("WebcastGiftMessage", { giftId: 5655, user: { nickname: "Ana", level: 12 } });
    rec.record("WebcastLikeMessage", { likeCount: 15, totalLikeCount: 900 });
    await rec.close();

    const lines = readLines(rec.filePath);
    expect(lines).toEqual([
      { t: 1000, type: "WebcastGiftMessage", event: { giftId: 5655, user: { nickname: "Ana", level: 12 } } },
      { t: 1000, type: "WebcastLikeMessage", event: { likeCount: 15, totalLikeCount: 900 } },
    ]);
  });

  it("nombra el archivo con la etiqueta y la fecha, dentro de la carpeta dada", async () => {
    const rec = new EventRecorder({ dir: tmp(), label: "@mi streamer!", now: () => Date.UTC(2026, 9, 4, 20, 58, 12) });
    rec.record("x", {});
    await rec.close();

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("live-_mi_streamer_-2026-10-04T20-58-12-000Z.jsonl");
  });

  it("serializa bigint, bytes y referencias circulares sin romperse", async () => {
    const rec = new EventRecorder({ dir: tmp() });
    const circular: any = { name: "a" };
    circular.self = circular;
    rec.record("raro", {
      userId: 12345678901234567890n,
      blob: new Uint8Array([1, 2, 3]),
      circular,
      lista: [1n, { ok: true }],
    });
    await rec.close();

    const [line] = readLines(rec.filePath);
    expect(line.event.userId).toBe("12345678901234567890");
    expect(line.event.blob).toBe("[bytes:3]");
    expect(line.event.circular).toEqual({ name: "a", self: "[Circular]" });
    expect(line.event.lista).toEqual(["1", { ok: true }]);
  });

  it("el mismo objeto en dos lugares (no circular) se guarda completo en ambos", async () => {
    const rec = new EventRecorder({ dir: tmp() });
    const shared = { id: 1 };
    rec.record("dag", { a: shared, b: shared });
    await rec.close();

    expect(readLines(rec.filePath)[0].event).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("deja de grabar al llegar al tope de bytes y avisa una sola vez", async () => {
    const logs: string[] = [];
    const rec = new EventRecorder({ dir: tmp(), maxBytes: 200, onLog: (m) => logs.push(m) });
    for (let i = 0; i < 50; i++) rec.record("e", { i, relleno: "x".repeat(40) });
    await rec.close();

    const lines = readLines(rec.filePath);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(50);
    expect(readFileSync(rec.filePath).byteLength).toBeLessThanOrEqual(200);
    expect(logs.filter((m) => m.includes("tope"))).toHaveLength(1);
  });

  it("no crea el archivo si nunca se graba nada", async () => {
    const rec = new EventRecorder({ dir: tmp() });
    await rec.close();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("nunca lanza al pipeline en vivo: un fallo se reporta por onLog", async () => {
    const logs: string[] = [];
    const rec = new EventRecorder({ dir: tmp(), onLog: (m) => logs.push(m) });
    const hostil = {
      get boom(): string {
        throw new Error("getter roto");
      },
    };
    expect(() => rec.record("hostil", hostil)).not.toThrow();
    expect(logs.some((m) => m.includes("getter roto"))).toBe(true);
    await rec.close();
  });
});

describe("EventRecorder compacto", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const likeEvent = (total: string) => ({
    type: "WebcastLikeMessage",
    data: {
      user: { id: "7", nickname: "Ana", avatarThumb: { uri: "a", urlList: ["x", "y", "z"] } },
      count: 3,
      total,
      common: { displayText: { defaultFormat: { color: "#fff" }, text: "liked" } },
    },
  });

  const lines = (path: string): any[] =>
    readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  it("por defecto: adelgaza y guarda compacto el tap repetido del mismo viewer", async () => {
    dir = mkdtempSync(join(tmpdir(), "streamtok-recorder-compact-"));
    const rec = new EventRecorder({ dir });
    rec.record("WebcastLikeMessage", likeEvent("10"));
    rec.record("WebcastLikeMessage", likeEvent("13"));
    await rec.close();
    const [first, second] = lines(rec.filePath);
    expect(first.ref).toBeUndefined();
    expect(first.event.data.user.avatarThumb.urlList).toEqual(["x"]);
    expect(first.event.data.common.displayText.defaultFormat).toBeUndefined();
    expect(second.ref).toBe("viewer-seen");
    expect(second.event).toEqual({ userId: "7", count: 3, total: "13" });
  });

  it("compact:false guarda todo tal cual llegó", async () => {
    dir = mkdtempSync(join(tmpdir(), "streamtok-recorder-full-"));
    const rec = new EventRecorder({ dir, compact: false });
    rec.record("WebcastLikeMessage", likeEvent("10"));
    rec.record("WebcastLikeMessage", likeEvent("13"));
    await rec.close();
    const [first, second] = lines(rec.filePath);
    expect(second.ref).toBeUndefined();
    expect(second.event).toEqual(likeEvent("13"));
    expect(first.event.data.user.avatarThumb.urlList).toHaveLength(3);
  });
});

describe("maxBytesFromEnv", () => {
  it("sin variable o inválida → undefined (tope por defecto)", () => {
    expect(maxBytesFromEnv({})).toBeUndefined();
    expect(maxBytesFromEnv({ STREAMTOK_RECORD_MAX_MB: "" })).toBeUndefined();
    expect(maxBytesFromEnv({ STREAMTOK_RECORD_MAX_MB: "abc" })).toBeUndefined();
    expect(maxBytesFromEnv({ STREAMTOK_RECORD_MAX_MB: "-5" })).toBeUndefined();
  });

  it("STREAMTOK_RECORD_MAX_MB define el tope en bytes", async () => {
    expect(maxBytesFromEnv({ STREAMTOK_RECORD_MAX_MB: "2" })).toBe(2 * 1024 * 1024);
    const dir = mkdtempSync(join(tmpdir(), "streamtok-recorder-env-"));
    try {
      const logs: string[] = [];
      const rec = new EventRecorder({
        dir,
        maxBytes: maxBytesFromEnv({ STREAMTOK_RECORD_MAX_MB: "0.0001" }), // ~104 bytes
        onLog: (m) => logs.push(m),
      });
      rec.record("e", { relleno: "x".repeat(500) });
      await rec.close();
      expect(logs.some((m) => m.includes("tope"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("TikTokLiveSource.recordRaw", () => {
  it("pasa cada mensaje decodificado a la grabadora, con su tipo", () => {
    const recorder = { record: vi.fn() };
    const source = new TikTokLiveSource("alguien", recorder as any);
    source.recordRaw("WebcastLinkMicBattle", { battleId: 1 });
    expect(recorder.record).toHaveBeenCalledWith("WebcastLinkMicBattle", { battleId: 1 });
  });

  it("sin grabadora no hace nada ni falla", () => {
    const source = new TikTokLiveSource("alguien");
    expect(() => source.recordRaw("X", {})).not.toThrow();
  });
});
