import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentConfigSchema, overlayPage } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";
import { AgenteController } from "../src/agente-controller.js";
import type { FetchLike } from "../src/agente-model.js";
import { VoiceService, buildStyle, extractWav, pcmToWav, speechText } from "../src/agente-voz.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const KEY = "AIza-secret-key-123456";
const PCM = Buffer.alloc(4800, 1); // 100 ms de audio a 24 kHz
const NEW_API = JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "text", text: "hola" }, { type: "audio", data: pcmToWav(PCM).toString("base64") }] }] });
const OLD_API = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: PCM.toString("base64") } }] } }] });

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeFetch(replies: { status: number; body: string }[]): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = replies[Math.min(i++, replies.length - 1)];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { fetchImpl, calls };
}

const REQ = { text: "Hola, gracias por seguirme.", mood: "calm" as const, voice: "Sulafat", style: "cálida y serena", model: "gemini-3.8-flash-tts" };

describe("speechText / buildStyle", () => {
  it("quita enlaces, emojis, formato y etiquetas de la voz", () => {
    expect(speechText("¡Hola! 😀 mira https://x.com/a **negrita** <laugh> |así| fin")).toBe("¡Hola! mira negrita así fin");
  });
  it("corta lo muy largo", () => {
    expect(speechText("a".repeat(900)).length).toBe(600);
  });
  it("suma el ánimo al estilo base", () => {
    expect(buildStyle("cálida", "calm")).toBe("cálida");
    expect(buildStyle("cálida", "happy")).toContain("cálida, alegre");
    expect(buildStyle("", "mystery")).toContain("misteriosa");
  });
});

describe("extractWav", () => {
  it("la API nueva: bloque audio dentro de steps (ya es WAV)", () => {
    const wav = extractWav(JSON.parse(NEW_API))!;
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBe(44 + PCM.length);
  });
  it("la API anterior: PCM crudo con rate en el mime → lo envuelve en WAV", () => {
    const wav = extractWav(JSON.parse(OLD_API))!;
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.subarray(44).equals(PCM)).toBe(true);
  });
  it("sin audio → null", () => {
    expect(extractWav({ steps: [{ type: "model_output", content: [{ type: "text", text: "x" }] }] })).toBeNull();
    expect(extractWav(null)).toBeNull();
  });
});

describe("VoiceService", () => {
  it("pide el audio con la clave, la voz y el estilo del turno", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: NEW_API }]);
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl });
    const r = await svc.synthesize(REQ, 100);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(calls[0].headers["x-goog-api-key"]).toBe(KEY);
    expect(calls[0].body.model).toBe("gemini-3.8-flash-tts");
    expect(calls[0].body.response_format).toEqual({ type: "audio" });
    expect(calls[0].body.generation_config.speech_config).toEqual([{ voice: "Sulafat" }]);
    const part = calls[0].body.input[0].content[0];
    expect(part.text).toBe("Hola, gracias por seguirme.");
    expect(part.annotations).toEqual([{ type: "speech_metadata", style: "cálida y serena" }]);
    expect(svc.ttsCalls).toBe(1);
  });

  it("la misma frase sale de la memoria: no gasta ni cuenta", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: NEW_API }]);
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl });
    await svc.synthesize(REQ, 100);
    const again = await svc.synthesize(REQ, 100);
    expect(again.ok && again.cached).toBe(true);
    expect(calls).toHaveLength(1);
    expect(svc.ttsCalls).toBe(1);
    // otro ánimo = otro audio
    await svc.synthesize({ ...REQ, mood: "happy" }, 100);
    expect(calls).toHaveLength(2);
  });

  it("sin clave: avisa sin llamar a nadie", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: NEW_API }]);
    const svc = new VoiceService({ getKey: () => undefined, fetchImpl });
    const r = await svc.synthesize(REQ, 100);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("clave de Gemini") });
    expect(calls).toHaveLength(0);
  });

  it("respeta el tope de audios por LIVE y resetSession lo reinicia", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: NEW_API }]);
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl });
    expect((await svc.synthesize({ ...REQ, text: "uno" }, 2)).ok).toBe(true);
    expect((await svc.synthesize({ ...REQ, text: "dos" }, 2)).ok).toBe(true);
    const r = await svc.synthesize({ ...REQ, text: "tres" }, 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("tope de 2");
    svc.resetSession();
    expect((await svc.synthesize({ ...REQ, text: "tres" }, 2)).ok).toBe(true);
  });

  it("limita el ritmo: no más de 20 audios nuevos por minuto", async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: NEW_API }]);
    let t = 1_000_000;
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl, now: () => t });
    for (let i = 0; i < 20; i++) expect((await svc.synthesize({ ...REQ, text: `frase ${i}` }, 1000)).ok).toBe(true);
    const over = await svc.synthesize({ ...REQ, text: "una más" }, 1000);
    expect(!over.ok && over.message).toContain("Demasiados");
    t += 61_000;
    expect((await svc.synthesize({ ...REQ, text: "una más" }, 1000)).ok).toBe(true);
  });

  it("un 404 de ruta prueba la API anterior", async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 404, body: JSON.stringify({ error: { message: "Not Found" } }) },
      { status: 200, body: OLD_API },
    ]);
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl });
    const r = await svc.synthesize(REQ, 100);
    expect(r.ok).toBe(true);
    expect(calls[1].url).toContain("/models/gemini-2.5-flash-preview-tts:generateContent");
    expect(calls[1].body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(calls[1].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Sulafat");
  });

  it("un 404 que habla del modelo NO cae a la API anterior: dice que cambies el modelo", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 404, body: JSON.stringify({ error: { message: "model gemini-9 is not found" } }) }]);
    const svc = new VoiceService({ getKey: () => KEY, fetchImpl });
    const r = await svc.synthesize(REQ, 100);
    expect(calls).toHaveLength(1);
    expect(!r.ok && r.message).toContain("Cambia el modelo de voz");
  });

  it("clave rechazada, sin audio y fallos de red: mensajes claros, sin la clave, y no cuentan para el tope", async () => {
    const svc401 = new VoiceService({ getKey: () => KEY, fetchImpl: fakeFetch([{ status: 403, body: "{}" }]).fetchImpl });
    const r1 = await svc401.synthesize(REQ, 100);
    expect(!r1.ok && r1.message).toContain("rechazó la clave");
    expect(svc401.ttsCalls).toBe(0);

    const svcEmpty = new VoiceService({ getKey: () => KEY, fetchImpl: fakeFetch([{ status: 200, body: JSON.stringify({ steps: [] }) }]).fetchImpl });
    const r2 = await svcEmpty.synthesize(REQ, 100);
    expect(!r2.ok && r2.message).toContain("sin audio");

    const boom: FetchLike = async () => {
      throw new Error(`fallo con ${KEY} dentro`);
    };
    const svcNet = new VoiceService({ getKey: () => KEY, fetchImpl: boom });
    const r3 = await svcNet.synthesize(REQ, 100);
    expect(!r3.ok && r3.message).toContain("No se pudo conectar con Gemini");
    expect(!r3.ok && r3.message).not.toContain(KEY);
  });
});

type Msg = { channel: string; payload: any };

describe("AgenteController: tts", () => {
  let server: StreamTokWsServer;
  const sockets: WebSocket[] = [];

  async function setup(getKey: () => string | undefined, fetchImpl: FetchLike) {
    server = new StreamTokWsServer(0);
    const engine = new AgenteEngine({ store: { load: () => ({ config: AgentConfigSchema.parse({ voice: { geminiVoice: "Achird", style: "tranquila" } }) }), save: async () => {} } });
    const voice = new VoiceService({ getKey, fetchImpl });
    new AgenteController(server, engine, undefined, undefined, voice);
    const ws = new WebSocket(`ws://127.0.0.1:${server.actualPort}`);
    sockets.push(ws);
    const inbox: Msg[] = [];
    ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
    await new Promise<void>((r) => ws.once("open", () => r()));
    const send = (payload: unknown) => ws.send(JSON.stringify({ channel: "agente", payload }));
    const next = async (pred: (m: Msg) => boolean) => {
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        const i = inbox.findIndex(pred);
        if (i !== -1) return inbox.splice(i, 1)[0];
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error("timeout");
    };
    return { send, next };
  }
  const isAudio = (id: string) => (m: Msg) => m.channel === "agente" && m.payload.kind === "tts-audio" && m.payload.id === id;

  beforeEach(() => {});
  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
    server?.close();
  });

  it("responde el audio WAV en base64 con la voz y el estilo guardados", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: NEW_API }]);
    const c = await setup(() => KEY, fetchImpl);
    c.send({ kind: "tts", id: "a1", text: "Hola a todos", mood: "happy" });
    const m = await c.next(isAudio("a1"));
    expect(m.payload.ok).toBe(true);
    expect(m.payload.mime).toBe("audio/wav");
    expect(Buffer.from(m.payload.data, "base64").subarray(0, 4).toString()).toBe("RIFF");
    expect(calls[0].body.generation_config.speech_config).toEqual([{ voice: "Achird" }]);
    expect(calls[0].body.input[0].content[0].annotations[0].style).toContain("tranquila, alegre");
  });

  it("al probar, manda la voz y el estilo que pide la app", async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: NEW_API }]);
    const c = await setup(() => KEY, fetchImpl);
    c.send({ kind: "tts", id: "p1", text: "Prueba", mood: "calm", voice: "Leda", style: "juvenil", model: "otro-modelo" });
    await c.next(isAudio("p1"));
    expect(calls[0].body.model).toBe("otro-modelo");
    expect(calls[0].body.generation_config.speech_config).toEqual([{ voice: "Leda" }]);
  });

  it("sin clave responde ok:false con el motivo (el overlay cae a la voz del equipo)", async () => {
    const c = await setup(() => undefined, fakeFetch([]).fetchImpl);
    c.send({ kind: "tts", id: "x", text: "Hola", mood: "calm" });
    const m = await c.next(isAudio("x"));
    expect(m.payload.ok).toBe(false);
    expect(m.payload.message).toContain("clave de Gemini");
    expect(m.payload.data).toBe("");
  });
});

describe("overlay agente: voz de la nube", () => {
  it("el JavaScript de la página es válido y trae la voz de la nube con respaldo", () => {
    const html = overlayPage("agente", 7331);
    const js = html.split("<script>").pop()!.split("</script>")[0];
    expect(() => new Function(js)).not.toThrow();
    expect(html).toContain("function speakCloud(");
    expect(html).toContain('kind: "tts"');
    expect(html).toContain('v.provider === "gemini"');
    expect(html).toContain("speakSystem(");
  });
});
