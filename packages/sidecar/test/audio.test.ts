import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  AudioPlayParamsSchema,
  AudioScheduler,
  decideAudioPlay,
  sanitizeAudioName,
  type AudioLike,
  type AudioPlayParams,
} from "@streamtok/shared";
import { AudioController, findMyInstantsMp3, isMyInstantsUrl, looksLikeAudio } from "../src/audio.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const mp3 = (extra = 8) => Buffer.concat([Buffer.from("ID3"), Buffer.alloc(extra, 1)]);
const b64 = (b: Buffer) => b.toString("base64");

describe("sanitizeAudioName", () => {
  it("quita rutas y caracteres inválidos y exige extensión de audio", () => {
    expect(sanitizeAudioName("C:\\audios\\boom.mp3")).toBe("boom.mp3");
    expect(sanitizeAudioName("../../etc/Ack!.WAV")).toBe("Ack!.wav");
    expect(sanitizeAudioName('a<b>:"c|d?*.ogg')).toBe("abcd.ogg");
    expect(sanitizeAudioName("   ")).toBeNull();
    expect(sanitizeAudioName("virus.exe")).toBeNull();
    expect(sanitizeAudioName(".mp3")).toBeNull();
    expect(sanitizeAudioName("sin-extension")).toBeNull();
  });
});

describe("decideAudioPlay (One-Shot, Saltar, Cola)", () => {
  const base = { oneShot: false, skip: false, queue: false };
  it("sin opciones suena a la vez que los demás", () => {
    expect(decideAudioPlay(["a.mp3"], [], { file: "a.mp3", ...base })).toEqual({ action: "play", stopAll: false });
  });
  it("One-Shot ignora el disparo si ese audio suena o espera, y deja pasar otro audio", () => {
    expect(decideAudioPlay(["a.mp3"], [], { file: "a.mp3", ...base, oneShot: true })).toEqual({ action: "ignore" });
    expect(decideAudioPlay([], ["a.mp3"], { file: "a.mp3", ...base, oneShot: true })).toEqual({ action: "ignore" });
    expect(decideAudioPlay(["b.mp3"], [], { file: "a.mp3", ...base, oneShot: true })).toEqual({ action: "play", stopAll: false });
  });
  it("Saltar corta todo y manda aunque sea One-Shot", () => {
    expect(decideAudioPlay(["a.mp3"], [], { file: "a.mp3", ...base, skip: true, oneShot: true })).toEqual({ action: "play", stopAll: true });
  });
  it("Cola espera solo si algo suena", () => {
    expect(decideAudioPlay(["b.mp3"], [], { file: "a.mp3", ...base, queue: true })).toEqual({ action: "queue" });
    expect(decideAudioPlay([], [], { file: "a.mp3", ...base, queue: true })).toEqual({ action: "play", stopAll: false });
  });
});

describe("AudioScheduler", () => {
  class FakeAudio implements AudioLike {
    volume = 1;
    paused = false;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public file: string) {}
    play = vi.fn(() => Promise.resolve());
    pause() {
      this.paused = true;
    }
    end() {
      this.onended?.();
    }
  }
  const make = () => {
    const made: FakeAudio[] = [];
    const errors: string[] = [];
    const sched = new AudioScheduler(
      (f) => {
        const a = new FakeAudio(f);
        made.push(a);
        return a;
      },
      (m) => errors.push(m),
    );
    return { sched, made, errors };
  };
  const req = (file: string, extra: Partial<AudioPlayParams> = {}): AudioPlayParams => ({
    file,
    volume: 50,
    oneShot: false,
    skip: false,
    queue: false,
    ...extra,
  });

  it("aplica el volumen (0–100 → 0–1) y suena a la vez sin opciones", () => {
    const { sched, made } = make();
    sched.play(req("a.mp3", { volume: 80 }));
    sched.play(req("b.mp3"));
    expect(made.map((m) => m.volume)).toEqual([0.8, 0.5]);
    expect(sched.active).toEqual(["a.mp3", "b.mp3"]);
  });

  it("One-Shot: ignora el repetido mientras suena y vuelve a sonar al terminar", () => {
    const { sched, made } = make();
    sched.play(req("a.mp3", { oneShot: true }));
    sched.play(req("a.mp3", { oneShot: true }));
    expect(made).toHaveLength(1);
    made[0].end();
    sched.play(req("a.mp3", { oneShot: true }));
    expect(made).toHaveLength(2);
  });

  it("Saltar corta lo que suena y vacía la cola", () => {
    const { sched, made } = make();
    sched.play(req("a.mp3"));
    sched.play(req("b.mp3", { queue: true })); // espera
    sched.play(req("c.mp3", { skip: true }));
    expect(made[0].paused).toBe(true);
    expect(sched.active).toEqual(["c.mp3"]);
    expect(sched.waiting).toEqual([]);
  });

  it("Cola: espera a que termine lo que suena y los siguientes entran en orden", () => {
    const { sched, made } = make();
    sched.play(req("a.mp3"));
    sched.play(req("b.mp3", { queue: true }));
    sched.play(req("c.mp3", { queue: true }));
    expect(sched.active).toEqual(["a.mp3"]);
    expect(sched.waiting).toEqual(["b.mp3", "c.mp3"]);
    made[0].end();
    expect(sched.active).toEqual(["b.mp3"]);
    made[1].end();
    expect(sched.active).toEqual(["c.mp3"]);
    made[2].end();
    expect(sched.active).toEqual([]);
  });

  it("si un audio falla avisa y sigue con la cola", async () => {
    const { sched, made, errors } = make();
    sched.play(req("a.mp3"));
    sched.play(req("b.mp3", { queue: true }));
    made[0].onerror?.();
    expect(errors).toEqual(['No se pudo reproducir "a.mp3".']);
    expect(sched.active).toEqual(["b.mp3"]);
  });

  it("si el navegador bloquea play() avisa con el error original", async () => {
    const errors: unknown[] = [];
    const sched = new AudioScheduler(
      () => ({ volume: 1, play: () => Promise.reject(new Error("bloqueado")), pause() {}, onended: null, onerror: null }),
      (_m, err) => errors.push(err),
    );
    sched.play(req("a.mp3"));
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect(sched.active).toEqual([]);
  });
});

describe("AudioPlayParamsSchema", () => {
  it("completa valores por defecto y rechaza volumen fuera de 0–100", () => {
    expect(AudioPlayParamsSchema.parse({ file: "a.mp3" })).toEqual({ file: "a.mp3", volume: 50, oneShot: false, skip: false, queue: false });
    expect(AudioPlayParamsSchema.safeParse({ file: "a.mp3", volume: 101 }).success).toBe(false);
    expect(AudioPlayParamsSchema.safeParse({ file: "" }).success).toBe(false);
  });
});

describe("looksLikeAudio", () => {
  it("reconoce mp3 (ID3 o frame), wav y ogg, y rechaza lo demás", () => {
    expect(looksLikeAudio(mp3(), "a.mp3")).toBe(true);
    expect(looksLikeAudio(Buffer.from([0xff, 0xfb, 0x90, 0]), "a.mp3")).toBe(true);
    expect(looksLikeAudio(Buffer.from("RIFF\0\0\0\0WAVEfmt "), "a.wav")).toBe(true);
    expect(looksLikeAudio(Buffer.from("OggS\0\0"), "a.ogg")).toBe(true);
    expect(looksLikeAudio(Buffer.from("MZ\x90\0"), "a.mp3")).toBe(false);
    expect(looksLikeAudio(Buffer.from("OggS"), "a.mp3")).toBe(false);
  });
});

describe("AudioController (ADR 0019)", () => {
  let dir = "";
  let server: StreamTokWsServer | null = null;
  afterEach(() => {
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const setup = (extra: Partial<ConstructorParameters<typeof AudioController>[1]> = {}) => {
    dir = mkdtempSync(join(tmpdir(), "streamtok-audios-"));
    const audiosDir = join(dir, "audios"); // aún no existe: el controlador la crea al subir
    server = new StreamTokWsServer(0);
    const controller = new AudioController(server, { dir: audiosDir, httpPort: () => 7340, ...extra });
    return { controller, audiosDir };
  };

  it("sin carpeta la lista está vacía; al subir se crea y se lista", () => {
    const { controller, audiosDir } = setup();
    expect(controller.list()).toEqual([]);
    const r = controller.upload("Boom.mp3", b64(mp3(20)));
    expect(r).toEqual({ ok: true, name: "Boom.mp3" });
    expect(existsSync(join(audiosDir, "Boom.mp3"))).toBe(true);
    expect(controller.list()).toEqual([{ name: "Boom.mp3", sizeBytes: 23, origin: "local" }]);
  });

  it("un nombre repetido no pisa al anterior: agrega (2)", () => {
    const { controller } = setup();
    controller.upload("boom.mp3", b64(mp3()));
    const r = controller.upload("boom.mp3", b64(mp3()));
    expect(r).toEqual({ ok: true, name: "boom (2).mp3" });
    expect(controller.list().map((f) => f.name)).toEqual(["boom (2).mp3", "boom.mp3"]);
  });

  it("rechaza extensiones no admitidas, archivos vacíos, falsos y demasiado grandes", () => {
    const { controller } = setup();
    expect(controller.upload("virus.exe", b64(mp3()))).toMatchObject({ ok: false });
    expect(controller.upload("vacio.mp3", "")).toMatchObject({ ok: false, error: expect.stringContaining("vacío") });
    expect(controller.upload("falso.mp3", b64(Buffer.from("MZ cualquier cosa")))).toMatchObject({
      ok: false,
      error: expect.stringContaining("no parece"),
    });
    const grande = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(10 * 1024 * 1024)]);
    expect(controller.upload("grande.mp3", b64(grande))).toMatchObject({ ok: false, error: expect.stringContaining("10 MB") });
    expect(controller.list()).toEqual([]);
  });

  it("la lista incluye los archivos que el streamer copió a mano y deja fuera lo que no es audio", () => {
    const { controller, audiosDir } = setup();
    controller.upload("a.mp3", b64(mp3()));
    writeFileSync(join(audiosDir, "(Planet of the Apes) acdc.mp3"), mp3());
    writeFileSync(join(audiosDir, "notas.txt"), "hola");
    expect(controller.list().map((f) => f.name)).toEqual(["(Planet of the Apes) acdc.mp3", "a.mp3"]);
  });

  it("resolveFile solo entrega archivos de audio directos de la carpeta (sin rutas)", () => {
    const { controller, audiosDir } = setup();
    controller.upload("a.mp3", b64(mp3()));
    expect(controller.resolveFile("a.mp3")).toBe(join(audiosDir, "a.mp3"));
    for (const mal of ["", "..", "../a.mp3", "x/a.mp3", "x\\a.mp3", "a.txt", "no-existe.mp3"]) {
      expect(controller.resolveFile(mal)).toBeNull();
    }
  });

  it("borra un archivo y no deja borrar fuera de la carpeta", () => {
    const { controller } = setup();
    controller.upload("a.mp3", b64(mp3()));
    expect(controller.remove("../a.mp3")).toMatchObject({ ok: false });
    expect(controller.remove("a.mp3")).toEqual({ ok: true });
    expect(controller.list()).toEqual([]);
    expect(controller.remove("a.mp3")).toMatchObject({ ok: false });
  });

  it("applyPlay valida los parámetros y que el archivo exista", () => {
    const { controller } = setup();
    expect(controller.applyPlay({ file: "a.mp3" })).toMatchObject({ ok: false, error: expect.stringContaining("ya no está") });
    expect(controller.applyPlay({ volume: 50 })).toMatchObject({ ok: false, error: expect.stringContaining("inválidos") });
    controller.upload("a.mp3", b64(mp3()));
    expect(controller.applyPlay({ file: "a.mp3", volume: 200 })).toMatchObject({ ok: false });
    expect(controller.applyPlay({ file: "a.mp3" })).toEqual({ ok: true });
  });

  it("por WS: manda el estado al conectar, avisa `play` y atiende subir/borrar/abrir carpeta", async () => {
    const opened: string[] = [];
    const { controller, audiosDir } = setup({ openFolder: (d) => opened.push(d) });
    const port = server!.actualPort || (await new Promise<number>((resolve) => server!.on("listening", (p) => resolve(p))));
    const ws = new WebSocket(`ws://localhost:${port}`);
    const got: any[] = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.channel === "audio") got.push(m.payload);
    });
    await new Promise((r) => ws.once("open", r));
    await vi.waitFor(() => expect(got[0]).toEqual({ kind: "state", files: [], dir: audiosDir, port: 7340 }));

    ws.send(JSON.stringify({ channel: "audio", payload: { kind: "upload", name: "a.mp3", data: b64(mp3()) } }));
    await vi.waitFor(() => expect(got.some((m) => m.kind === "state" && m.files.length === 1)).toBe(true));

    ws.send(JSON.stringify({ channel: "audio", payload: { kind: "upload", name: "malo.exe", data: b64(mp3()) } }));
    await vi.waitFor(() => expect(got.some((m) => m.kind === "error")).toBe(true));

    ws.send(JSON.stringify({ channel: "audio", payload: { kind: "play", file: "a.mp3", volume: 70, queue: true } }));
    await vi.waitFor(() =>
      expect(got.find((m) => m.kind === "play")).toEqual({ kind: "play", file: "a.mp3", volume: 70, oneShot: false, skip: false, queue: true }),
    );
    expect(controller.applyPlay({ file: "a.mp3" })).toEqual({ ok: true });

    ws.send(JSON.stringify({ channel: "audio", payload: { kind: "open-folder" } }));
    await vi.waitFor(() => expect(opened).toEqual([audiosDir]));

    ws.send(JSON.stringify({ channel: "audio", payload: { kind: "delete", name: "a.mp3" } }));
    await vi.waitFor(() => expect(controller.list()).toEqual([]));
    ws.close();
  });

  describe("MyInstants", () => {
    const withUrl = (r: Response, url: string) => Object.defineProperty(r, "url", { value: url });
    const page = '<html><a href="/media/sounds/vine-boom.mp3">x</a></html>';
    const fakeFetch = (calls: string[] = []) =>
      (async (input: string | URL | Request) => {
        const u = String(input);
        calls.push(u);
        if (u.endsWith(".mp3")) {
          return withUrl(new Response(new Uint8Array(mp3(40))), u);
        }
        return withUrl(new Response(page), u);
      }) as unknown as typeof fetch;

    it("solo acepta enlaces https de myinstants.com y encuentra el MP3 en la página", () => {
      expect(isMyInstantsUrl("https://www.myinstants.com/es/instant/vine-boom-1/")).not.toBeNull();
      expect(isMyInstantsUrl("http://www.myinstants.com/x")).toBeNull();
      expect(isMyInstantsUrl("https://evil.com/myinstants.com/x.mp3")).toBeNull();
      expect(isMyInstantsUrl("https://myinstants.com.evil.com/x")).toBeNull();
      expect(findMyInstantsMp3(page)).toBe("https://www.myinstants.com/media/sounds/vine-boom.mp3");
      expect(findMyInstantsMp3("<html></html>")).toBeNull();
    });

    it("agrega desde la página del sonido, queda como myinstants y se borra con su registro", async () => {
      const calls: string[] = [];
      const { controller, audiosDir } = setup({ fetchFn: fakeFetch(calls) });
      const r = await controller.addFromUrl("https://www.myinstants.com/es/instant/vine-boom-1/");
      expect(r).toEqual({ ok: true, name: "vine-boom.mp3" });
      expect(calls).toEqual([
        "https://www.myinstants.com/es/instant/vine-boom-1/",
        "https://www.myinstants.com/media/sounds/vine-boom.mp3",
      ]);
      controller.upload("mio.mp3", b64(mp3()));
      expect(controller.list().map((f) => [f.name, f.origin])).toEqual([
        ["mio.mp3", "local"],
        ["vine-boom.mp3", "myinstants"],
      ]);
      expect(controller.remove("vine-boom.mp3")).toEqual({ ok: true });
      expect(existsSync(join(audiosDir, "origenes.json"))).toBe(true);
      expect(controller.list().map((f) => f.name)).toEqual(["mio.mp3"]);
    });

    it("acepta el MP3 directo y rechaza enlaces ajenos o páginas sin audio", async () => {
      const { controller } = setup({ fetchFn: fakeFetch() });
      expect(await controller.addFromUrl("https://www.myinstants.com/media/sounds/otro.mp3")).toEqual({ ok: true, name: "otro.mp3" });
      expect(await controller.addFromUrl("https://example.com/a.mp3")).toMatchObject({ ok: false });
      const empty = (async () => withUrl(new Response("<html/>"), "https://www.myinstants.com/x")) as unknown as typeof fetch;
      const c2 = setup({ fetchFn: empty }).controller;
      expect(await c2.addFromUrl("https://www.myinstants.com/es/instant/nada/")).toMatchObject({ ok: false, error: expect.stringContaining("No encontré") });
    });

    it("abre la página de MyInstants desde el canal WS", async () => {
      const opened: string[] = [];
      const { controller } = setup({ openUrl: (u) => opened.push(u) });
      void controller;
      const port = server!.actualPort || (await new Promise<number>((r) => server!.once("listening", () => r(server!.actualPort))));
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise((r) => ws.on("open", r));
      ws.send(JSON.stringify({ channel: "audio", payload: { kind: "open-myinstants" } }));
      await vi.waitFor(() => expect(opened).toEqual(["https://www.myinstants.com/es/index/pe/"]));
      ws.close();
    });
  });
});
