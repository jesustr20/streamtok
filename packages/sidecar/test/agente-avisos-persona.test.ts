import { describe, expect, it } from "vitest";
import { AgentConfigSchema, type AgentConfig, type LiveEvent } from "@streamtok/shared";
import { AgenteEngine, joinNames } from "../src/agente.js";
import { systemPrompt } from "../src/agente-guard.js";
import type { FetchLike } from "../src/agente-model.js";
import { VoiceService } from "../src/agente-voz.js";

const ev = (event: LiveEvent["event"], username: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({ event, username, nickname: username, timestamp: 0, ...extra });

function setup(config: Record<string, unknown> = {}) {
  let t = 1_000_000;
  const engine = new AgenteEngine({
    store: { load: () => ({ config: AgentConfigSchema.parse({ enabled: true, ...config }) }), save: async () => {} },
    now: () => t,
    random: () => 0,
    // nunca responde: la primera pregunta se queda «en pantalla» y las demás esperan
    responder: () => new Promise<string>(() => {}),
  });
  const advance = (ms: number) => {
    t += ms;
    engine.tick();
  };
  const texts = () => (engine.getState().notices ?? []).map((n) => n.text);
  const ask = (u: string, q = "hola") => engine.handleLiveEvent(ev("comment", u, { text: `${engine.getConfig().command} ${q}`, isFollower: true }));
  return { engine, advance, texts, ask };
}

describe("joinNames", () => {
  it("une los nombres como se dirían en voz alta", () => {
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Luis"])).toBe("Ana y Luis");
    expect(joinNames(["Ana", "Luis", "Eva"])).toBe("Ana, Luis y Eva");
    expect(joinNames(["a", "b", "c", "d", "e"])).toBe("a, b, c y 2 más");
  });
});

describe("avisos a cada persona", () => {
  it("avisa que su pregunta está en la fila, con el lugar", () => {
    const h = setup();
    h.ask("ana");
    h.ask("luis");
    expect(h.texts().some((x) => /luis.*en la fila/i.test(x))).toBe(true);
    expect(h.texts().some((x) => /ana/i.test(x))).toBe(false); // la primera empieza al momento
  });

  it("un regalo sube su pregunta a Prioridad y lo dice", () => {
    const h = setup();
    h.ask("ana");
    h.ask("luis");
    h.engine.handleLiveEvent(ev("gift", "luis", { coins: 50, repeatEnd: true, giftId: 1 }));
    expect(h.texts().some((x) => /luis/i.test(x) && /prioridad/i.test(x))).toBe(true);
  });

  it("agradece el regalo a quien aún no preguntó e indica cómo usarlo", () => {
    const h = setup();
    h.engine.handleLiveEvent(ev("gift", "eva", { coins: 30, repeatEnd: true, giftId: 1 }));
    const t = h.texts().find((x) => /eva/i.test(x));
    expect(t).toMatch(/prioridad/i);
    expect(t).toContain(h.engine.getConfig().command);
  });

  it("junta los seguidores nuevos en un solo gracias", () => {
    const h = setup();
    for (const u of ["a1", "a2", "a3"]) h.engine.handleLiveEvent(ev("follow", u));
    expect(h.texts()).toHaveLength(0); // se espera para agrupar
    h.advance(20_000);
    const t = h.texts();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatch(/gracias por seguir/i);
    expect(t[0]).toContain("a1, a2 y a3");
  });

  it("los avisos caducan solos", () => {
    const h = setup();
    h.ask("ana");
    h.ask("luis");
    expect(h.texts().length).toBeGreaterThan(0);
    h.advance(60_000);
    expect(h.texts()).toHaveLength(0);
  });

  it("no avisa si el streamer lo apagó, y sin voz salen mudos", () => {
    const off = setup({ tips: { personal: false } });
    off.ask("ana");
    off.ask("luis");
    expect(off.texts()).toHaveLength(0);
    const mute = setup({ tips: { speakThanks: false } });
    mute.ask("ana");
    mute.ask("luis");
    expect(mute.engine.getState().notices?.every((n) => !n.speak)).toBe(true);
    const noFollow = setup({ tips: { thanksFollows: false } });
    noFollow.engine.handleLiveEvent(ev("follow", "zoe"));
    noFollow.advance(30_000);
    expect(noFollow.texts()).toHaveLength(0);
  });

  it("nombres raros se acortan y pierden la @", () => {
    const h = setup();
    h.ask("ana");
    h.engine.handleLiveEvent(ev("comment", "x", { nickname: "@" + "n".repeat(40), text: `${h.engine.getConfig().command} hola`, isFollower: true }));
    expect(h.texts().some((x) => x.includes("…") && !x.includes("@"))).toBe(true);
  });
});

describe("Contexto del LIVE en el prompt", () => {
  const base = AgentConfigSchema.parse({});
  it("sin contexto no cambia nada", () => {
    expect(systemPrompt(base)).not.toContain("Contexto del canal");
  });
  it("con contexto lo añade como dato y sin símbolos de etiqueta", () => {
    const p = systemPrompt({ ...base, liveContext: "Hoy juego <GTA> en modo historia" } as AgentConfig);
    expect(p).toContain("Contexto del canal (solo informativo): Hoy juego GTA en modo historia.");
    expect(p).not.toContain("<GTA>");
  });
});

describe("VoiceService.listModels", () => {
  const list = (status: number, body: unknown) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: status < 300, status, text: async () => JSON.stringify(body) };
    };
    return { svc: new VoiceService({ getKey: () => "AIza-k-123456789", fetchImpl }), calls };
  };
  it("deja solo los modelos de voz, sin «models/» y ordenados", async () => {
    const { svc, calls } = list(200, { models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-3.8-flash-tts" }, { name: "models/gemini-2.5-pro-tts" }, { name: "models/gemini-3.8-flash-tts" }] });
    const r = await svc.listModels();
    expect(r).toEqual({ ok: true, models: ["gemini-2.5-pro-tts", "gemini-3.8-flash-tts"], message: "" });
    expect(calls[0].headers["x-goog-api-key"]).toBe("AIza-k-123456789");
  });
  it("explica la falta de clave y los errores sin filtrar la clave", async () => {
    expect((await new VoiceService({ getKey: () => undefined }).listModels()).message).toMatch(/clave/i);
    const bad = await list(403, { error: { message: "no" } }).svc.listModels();
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain("AIza");
    expect((await list(200, { models: [{ name: "models/gemini-2.5-flash" }] }).svc.listModels()).ok).toBe(false);
  });
});

describe("overlay: la voz del equipo sigue el ánimo", () => {
  it("el script usa el ánimo del LIVE para el ritmo y el tono", async () => {
    const { overlayPage } = await import("@streamtok/shared");
    const html = overlayPage("agente", 7331);
    expect(html).toContain("MOOD_VOICE");
    expect(html).toContain("liveMood = !DEMO && m.payload.animo");
  });
});
