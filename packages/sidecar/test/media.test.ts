import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { MediaShowParamsSchema, looksLikeMedia, mediaKindOf, mediaScreenPage, parseMediaUrl, sanitizeMediaName } from "@streamtok/shared";
import { MediaController } from "../src/media.js";
import { OverlayHttpServer } from "../src/overlay-server.js";
import { StreamTokWsServer } from "../src/ws-server.js";
import { validateAcciones } from "../src/acciones-eventos.js";

const png = (extra = 16) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 1)]);
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(40, 2)]);
const b64 = (b: Buffer) => b.toString("base64");

describe("utilidades de medios (ADR 0022)", () => {
  it("distingue imagen y video por extensión", () => {
    expect(mediaKindOf("a.GIF")).toBe("image");
    expect(mediaKindOf("a.mp4")).toBe("video");
    expect(mediaKindOf("a.exe")).toBeNull();
    expect(mediaKindOf("sin-extension")).toBeNull();
  });

  it("limpia el nombre: sin rutas ni caracteres raros, extensión en minúscula", () => {
    expect(sanitizeMediaName("C:\\fotos\\Gato<>.PNG")).toBe("Gato.png");
    expect(sanitizeMediaName("../../x.mp4")).toBe("x.mp4");
    expect(sanitizeMediaName("virus.exe")).toBeNull();
    expect(sanitizeMediaName(".png")).toBeNull();
  });

  it("revisa los primeros bytes", () => {
    expect(looksLikeMedia(png(), "a.png")).toBe(true);
    expect(looksLikeMedia(Buffer.from("MZ cualquier cosa"), "a.png")).toBe(false);
    expect(looksLikeMedia(mp4(), "a.mp4")).toBe(true);
    expect(looksLikeMedia(Buffer.from("GIF89a....."), "a.gif")).toBe(true);
    expect(looksLikeMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "a.jpg")).toBe(true);
    expect(looksLikeMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), "a.webm")).toBe(true);
  });

  it("solo acepta URLs http(s)", () => {
    expect(parseMediaUrl("https://x.com/a.gif")).not.toBeNull();
    expect(parseMediaUrl("javascript:alert(1)")).toBeNull();
    expect(parseMediaUrl("file:///c:/a.png")).toBeNull();
    expect(parseMediaUrl("no es url")).toBeNull();
  });

  it("los parámetros piden archivo (local) o URL (web) y ponen valores por defecto", () => {
    expect(MediaShowParamsSchema.safeParse({}).success).toBe(false);
    expect(MediaShowParamsSchema.safeParse({ source: "web" }).success).toBe(false);
    const ok = MediaShowParamsSchema.parse({ file: "a.png" });
    expect(ok).toMatchObject({ source: "local", screen: 1, sizePct: 50, durationSec: 0, volume: 50 });
    expect(MediaShowParamsSchema.safeParse({ file: "a.png", screen: 0 }).success).toBe(false);
    expect(MediaShowParamsSchema.safeParse({ file: "a.png", sizePct: 5 }).success).toBe(false);
  });

  it("la página de la pantalla es JavaScript válido y lleva puerto y número", () => {
    const html = mediaScreenPage(7331, 3);
    expect(html).toContain("var WS_PORT = 7331;");
    expect(html).toContain("var SCREEN = 3;");
    const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "").pop() ?? "";
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toContain("`");
    expect(js).not.toContain("${");
  });
});

describe("MediaController y servidor HTTP (ADR 0022)", () => {
  let dir = "";
  let server: StreamTokWsServer | null = null;
  let http: OverlayHttpServer | null = null;
  afterEach(async () => {
    await http?.close();
    http = null;
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), "streamtok-media-"));
    server = new StreamTokWsServer(0);
    const controller = new MediaController(server, { dir: join(dir, "media"), httpPort: () => 7340, openFolder: () => {} });
    return { controller };
  };

  it("sube, lista, no pisa nombres y borra", () => {
    const { controller } = setup();
    expect(controller.list()).toEqual([]);
    expect(controller.upload("Gato.png", b64(png()))).toEqual({ ok: true, name: "Gato.png" });
    expect(controller.upload("Gato.png", b64(png()))).toEqual({ ok: true, name: "Gato (2).png" });
    expect(controller.upload("v.mp4", b64(mp4()))).toEqual({ ok: true, name: "v.mp4" });
    expect(controller.list().map((f) => [f.name, f.kind])).toEqual([
      ["Gato (2).png", "image"],
      ["Gato.png", "image"],
      ["v.mp4", "video"],
    ]);
    expect(controller.remove("Gato.png")).toEqual({ ok: true });
    expect(controller.remove("../x.png")).toMatchObject({ ok: false });
  });

  it("rechaza formatos no admitidos, vacíos y falsos", () => {
    const { controller } = setup();
    expect(controller.upload("a.exe", b64(png()))).toMatchObject({ ok: false });
    expect(controller.upload("a.png", "")).toMatchObject({ ok: false, error: expect.stringContaining("vacío") });
    expect(controller.upload("a.png", b64(Buffer.from("MZ nada")))).toMatchObject({ ok: false, error: expect.stringContaining("no parece") });
  });

  it("guarda enlaces web sin repetirlos y los quita", () => {
    const { controller } = setup();
    expect(controller.addWeb("https://x.com/a.gif", "Mi gif")).toEqual({ ok: true });
    expect(controller.addWeb("https://x.com/a.gif", "Otro nombre")).toEqual({ ok: true });
    expect(controller.addWeb("ftp://x.com/a.gif", "mal")).toMatchObject({ ok: false });
    expect(controller.listWeb()).toEqual([{ name: "Otro nombre", url: "https://x.com/a.gif" }]);
    controller.removeWeb("https://x.com/a.gif");
    expect(controller.listWeb()).toEqual([]);
  });

  it("applyShow valida y avisa por el canal media", async () => {
    const { controller } = setup();
    controller.upload("Gato.png", b64(png()));
    expect(controller.applyShow({})).toMatchObject({ ok: false });
    expect(controller.applyShow({ file: "fantasma.png" })).toMatchObject({ ok: false, error: expect.stringContaining("ya no está") });
    expect(controller.applyShow({ source: "web", url: "javascript:x" })).toMatchObject({ ok: false });

    const port = (server as unknown as { actualPort: number }).actualPort;
    const ws = new WebSocket(`ws://localhost:${port}`);
    const got: unknown[] = [];
    ws.on("message", (d) => got.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once("open", r));
    await new Promise((r) => setTimeout(r, 50));
    expect(controller.applyShow({ file: "Gato.png", screen: 2, sizePct: 80 })).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    const shown = got.find((m) => (m as { channel?: string; payload?: { kind?: string } }).payload?.kind === "show") as {
      channel: string;
      payload: Record<string, unknown>;
    };
    expect(shown.channel).toBe("media");
    expect(shown.payload).toMatchObject({ source: "local", file: "Gato.png", screen: 2, sizePct: 80, durationSec: 0 });
  });

  it("sirve /media con Range y la página /overlay/pantalla/<n>", async () => {
    const { controller } = setup();
    controller.upload("v.mp4", b64(mp4()));
    http = new OverlayHttpServer({ port: 0, wsPort: 7331, mediaFile: (n) => controller.resolveFile(n) });
    const port = await http.listen();
    const base = `http://127.0.0.1:${port}`;

    const full = await fetch(`${base}/media/v.mp4`);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect((await full.arrayBuffer()).byteLength).toBe(mp4().length);

    const part = await fetch(`${base}/media/v.mp4`, { headers: { Range: "bytes=0-9" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${mp4().length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);

    expect((await fetch(`${base}/media/v.mp4`, { headers: { Range: "bytes=999-" } })).status).toBe(416);
    expect((await fetch(`${base}/media/nada.png`)).status).toBe(404);
    expect((await fetch(`${base}/media/..%2Fx.png`)).status).toBe(404);

    const page = await fetch(`${base}/overlay/pantalla/2`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("var SCREEN = 2;");
    expect((await fetch(`${base}/overlay/pantalla`)).status).toBe(200);
    expect((await fetch(`${base}/overlay/pantalla/10`)).status).toBe(404);
  });

  it("validateAcciones revisa Mostrar medios con su propio esquema", () => {
    const base = { id: "a1", nombre: "Meme", descripcion: "", duracionSeg: 0, puntos: 0, pantalla: null, media: { animacion: false, imagen: false, sonido: false, video: false }, repetirConComboDeRegalos: false, cooldownGlobalSeg: 0, cooldownUsuarioSeg: 0 };
    const catalog = { actions: [] } as never;
    const bad = validateAcciones([{ ...base, comandos: [{ modActionId: "app.media.show", params: {} }] }], catalog);
    expect(bad.ok).toBe(false);
    const good = validateAcciones([{ ...base, comandos: [{ modActionId: "app.media.show", params: { file: "Gato.png" } }] }], catalog);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.acciones[0].comandos[0].params).toMatchObject({ file: "Gato.png", screen: 1, sizePct: 50 });
  });
});
