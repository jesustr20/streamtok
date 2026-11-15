import { AgentConfigSchema } from "@streamtok/shared";
import { describe, expect, it } from "vitest";
import { ListenService, parseHeard } from "../src/agente-escucha.js";
import type { FetchLike } from "../src/agente-model.js";

const config = AgentConfigSchema.parse({ name: "Nova" });
const wav = Buffer.alloc(2000).toString("base64");

function fake(reply: string | { status: number }, seen: { body?: string; url?: string } = {}): FetchLike {
  return async (url, init) => {
    seen.url = url;
    seen.body = init.body;
    if (typeof reply !== "string") return { ok: false, status: reply.status, text: async () => "{}" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }) };
  };
}

describe("parseHeard", () => {
  it("entiende stop y ask, con o sin bloque de código", () => {
    expect(parseHeard('{"text":"Nova, para","intent":"stop","question":""}')).toMatchObject({ intent: "stop" });
    expect(parseHeard('```json\n{"text":"Nova, ¿qué hora es?","intent":"ask","question":"¿qué hora es?"}\n```')).toMatchObject({ intent: "ask", question: "¿qué hora es?" });
  });
  it("ask sin pregunta o intent raro = none; basura = null", () => {
    expect(parseHeard('{"text":"Nova","intent":"ask","question":""}')?.intent).toBe("none");
    expect(parseHeard('{"text":"x","intent":"hackea","question":"y"}')?.intent).toBe("none");
    expect(parseHeard("no es json")).toBeNull();
  });
});

describe("ListenService", () => {
  it("manda el audio y el nombre a Gemini y devuelve lo entendido", async () => {
    const seen: { body?: string; url?: string } = {};
    const svc = new ListenService({ getKey: () => "k".repeat(12), fetchImpl: fake('{"text":"Nova, para","intent":"stop","question":""}', seen) });
    const r = await svc.hear(wav, config);
    expect(r).toMatchObject({ ok: true, intent: "stop" });
    expect(seen.url).toContain(config.voice.listenModel);
    expect(seen.body).toContain("«Nova»");
    expect(seen.body).toContain("audio/wav");
  });

  it("sin clave no llama", async () => {
    const svc = new ListenService({ getKey: () => undefined, fetchImpl: fake("{}") });
    expect(await svc.hear(wav, config)).toMatchObject({ ok: false });
  });

  it("limita las llamadas por minuto y no cobra las que fallan", async () => {
    let t = 0;
    const svc = new ListenService({ getKey: () => "k".repeat(12), fetchImpl: fake('{"text":"","intent":"none","question":""}'), now: () => t });
    for (let i = 0; i < 12; i++) expect((await svc.hear(wav, config)).ok).toBe(true);
    expect(await svc.hear(wav, config)).toMatchObject({ ok: false });
    t += 61_000;
    expect((await svc.hear(wav, config)).ok).toBe(true);
    const bad = new ListenService({ getKey: () => "k".repeat(12), fetchImpl: fake({ status: 429 }) });
    expect(await bad.hear(wav, config)).toMatchObject({ ok: false });
    expect(bad.listenCalls).toBe(0);
  });

  it("respeta el tope por LIVE y rechaza audios enormes", async () => {
    const cfg = AgentConfigSchema.parse({ name: "Nova", voice: { maxListenCalls: 1 } });
    const svc = new ListenService({ getKey: () => "k".repeat(12), fetchImpl: fake('{"text":"","intent":"none","question":""}') });
    expect((await svc.hear(wav, cfg)).ok).toBe(true);
    expect(await svc.hear(wav, cfg)).toMatchObject({ ok: false });
    svc.resetSession();
    expect(await svc.hear("A".repeat(2_000_000), config)).toMatchObject({ ok: false });
  });
});
