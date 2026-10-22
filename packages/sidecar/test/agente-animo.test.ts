import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AgentAnimoSchema, AgentConfigSchema, type LiveEvent } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";
import { LiveMoodEngine, pointsFor } from "../src/agente-animo.js";
import { AgenteController } from "../src/agente-controller.js";
import { systemPrompt } from "../src/agente-guard.js";
import { ModelService, type FetchLike } from "../src/agente-model.js";
import { VoiceService, pcmToWav } from "../src/agente-voz.js";
import { StreamTokWsServer } from "../src/ws-server.js";

const ev = (event: LiveEvent["event"], extra: Partial<LiveEvent> = {}): LiveEvent => ({ event, username: "u", timestamp: 0, ...extra });

function engine(animo: Partial<ReturnType<typeof AgentAnimoSchema.parse>> = {}) {
  let t = 1_000_000;
  const cfg = AgentAnimoSchema.parse(animo);
  const e = new LiveMoodEngine({ getConfig: () => cfg, now: () => t });
  return { e, advance: (ms: number) => (t += ms), cfg };
}

/** `perMin` comentarios por minuto durante `sec` segundos. */
function chat(h: ReturnType<typeof engine>, perMin: number, sec: number) {
  const every = 60_000 / perMin;
  for (let ms = 0; ms < sec * 1000; ms += every) {
    h.advance(every);
    h.e.handleLiveEvent(ev("comment"));
  }
}

describe("pointsFor", () => {
  it("cada cosa pesa distinto: comentario, seguidor, compartido, regalo por monedas", () => {
    expect(pointsFor(ev("comment"))).toBe(1.5);
    expect(pointsFor(ev("follow"))).toBe(5);
    expect(pointsFor(ev("share"))).toBe(6);
    expect(pointsFor(ev("join"))).toBeLessThan(0.5);
    expect(pointsFor(ev("gift", { coins: 10 }))).toBeCloseTo(3);
    expect(pointsFor(ev("gift", { coins: 100000 }))).toBe(150); // tope
  });
  it("los likes cuentan por toque, con tope por mensaje", () => {
    expect(pointsFor(ev("like"))).toBeCloseTo(0.05);
    expect(pointsFor(ev("like", { likeCount: 12 }))).toBeCloseTo(0.6);
    expect(pointsFor(ev("like", { likeCount: 5000 }))).toBeCloseTo(1.5);
  });
  it("un combo de regalos en curso suma poco; el cierre trae las monedas", () => {
    expect(pointsFor(ev("gift", { coins: 5, repeatEnd: false }))).toBe(2);
    expect(pointsFor(ev("gift", { coins: 5, repeatEnd: true }))).toBeCloseTo(1.5);
  });
});

describe("LiveMoodEngine", () => {
  it("empieza en calma, con ánimo tranquilo", () => {
    const { e } = engine();
    expect(e.getState()).toEqual({ energy: 0, level: "calm", mood: "calm", spike: false });
  });

  it("un LIVE tranquilo (pocos comentarios) se queda en calma", () => {
    const h = engine();
    chat(h, 1, 300);
    expect(h.e.getState().level).toBe("calm");
  });

  it("comentarios sostenidos lo suben a normal, animado y a tope; el ánimo de voz acompaña", () => {
    const normal = engine();
    chat(normal, 6, 240);
    expect(normal.e.getState().level).toBe("normal");
    expect(normal.e.mood()).toBe("calm");

    const lively = engine();
    chat(lively, 16, 240);
    expect(lively.e.getState().level).toBe("lively");
    expect(lively.e.mood()).toBe("happy");

    const hype = engine();
    chat(hype, 40, 240);
    expect(hype.e.getState().level).toBe("hype");
    expect(hype.e.mood()).toBe("excited");
  });

  it("al parar el movimiento la energía baja sola, y baja de nivel con margen (sin oscilar)", () => {
    const h = engine();
    chat(h, 40, 240);
    expect(h.e.getState().level).toBe("hype");
    const levels: string[] = [];
    for (let i = 0; i < 400; i++) {
      h.advance(1000);
      levels.push(h.e.getState().level);
    }
    // baja en orden y no vuelve a subir
    const order = ["hype", "lively", "normal", "calm"];
    const idx = levels.map((l) => order.indexOf(l));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    expect(levels.at(-1)).toBe("calm");
  });

  it("un regalo grande sube el ánimo de golpe un rato y luego vuelve", () => {
    const h = engine();
    h.e.handleLiveEvent(ev("gift", { coins: 200, repeatEnd: true }));
    expect(h.e.getState()).toMatchObject({ spike: true, mood: "excited" });
    h.advance(24_000);
    expect(h.e.getState().spike).toBe(true);
    h.advance(2_000);
    expect(h.e.getState().spike).toBe(false);
  });

  it("un regalo chico no hace subidón; un combo en curso tampoco aunque traiga muchas monedas acumuladas", () => {
    const h = engine();
    h.e.handleLiveEvent(ev("gift", { coins: 10, repeatEnd: true }));
    h.e.handleLiveEvent(ev("gift", { coins: 999, repeatEnd: false }));
    expect(h.e.getState().spike).toBe(false);
  });

  it("la sensibilidad mueve la energía y el umbral del regalo grande", () => {
    const low = engine({ sensitivity: 0.5 });
    const high = engine({ sensitivity: 2 });
    chat(low, 16, 240);
    chat(high, 16, 240);
    expect(high.e.getState().energy).toBeGreaterThan(low.e.getState().energy + 20);
    low.e.handleLiveEvent(ev("gift", { coins: 200, repeatEnd: true }));
    high.e.handleLiveEvent(ev("gift", { coins: 100, repeatEnd: true }));
    expect(low.e.getState().spike).toBe(false); // con sensibilidad baja 200 no alcanza (umbral 300)
    expect(high.e.getState().spike).toBe(true); // con alta, 100 sí (umbral 75)
  });

  it("boost sube el ánimo para la prueba, y reset vuelve a la calma", () => {
    const h = engine();
    h.e.boost();
    expect(h.e.getState()).toMatchObject({ spike: true, mood: "excited" });
    h.e.reset();
    expect(h.e.getState()).toEqual({ energy: 0, level: "calm", mood: "calm", spike: false });
  });

  it("apagado: la voz queda tranquila y no hay contexto para el modelo", () => {
    const h = engine({ enabled: false });
    h.e.boost();
    expect(h.e.mood()).toBe("calm");
    expect(h.e.contextLine()).toBeUndefined();
  });

  it("contexto para el modelo según el nivel; nada en normal; se puede quitar", () => {
    const h = engine();
    expect(h.e.contextLine()).toContain("tranquilo");
    chat(h, 6, 240);
    expect(h.e.getState().level).toBe("normal");
    expect(h.e.contextLine()).toBeUndefined();
    chat(h, 40, 240);
    expect(h.e.contextLine()).toContain("a tope");
    h.e.boost();
    expect(h.e.contextLine()).toContain("regalo grande");
    expect(engine({ textContext: false }).e.contextLine()).toBeUndefined();
  });

  it("avisa de cambios sin saturar: como mucho un 'state' cada 2 s, no uno por comentario", () => {
    const h = engine();
    let n = 0;
    h.e.on("state", () => n++);
    chat(h, 40, 60); // 40 comentarios en un minuto
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(31);
  });
});

describe("el ánimo llega al modelo", () => {
  it("systemPrompt suma la línea de contexto solo si hay", () => {
    const c = AgentConfigSchema.parse({});
    expect(systemPrompt(c)).not.toContain("LIVE está");
    expect(systemPrompt(c, "El LIVE está animado: responde con buena energía.")).toContain("El LIVE está animado");
  });

  it("ModelService manda esa línea en el prompt de sistema", async () => {
    const bodies: any[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(init.body ?? "{}"));
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "Ocho." } }] }) };
    };
    const svc = new ModelService({ keys: { load: () => ({ keys: { deepseek: "k-123456789" } }), save: async () => {} }, fetchImpl, liveContext: () => "El LIVE está a tope de energía." });
    await svc.respond("¿cuánto es 4+4?", { config: AgentConfigSchema.parse({}) } as never);
    expect(bodies[0].messages[0].content).toContain("El LIVE está a tope de energía.");
  });
});

type Msg = { channel: string; payload: any };

describe("AgenteController: ánimo", () => {
  let server: StreamTokWsServer;
  const sockets: WebSocket[] = [];
  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
    server?.close();
  });

  async function setup() {
    server = new StreamTokWsServer(0);
    const agente = new AgenteEngine({ store: { load: () => ({ config: AgentConfigSchema.parse({}) }), save: async () => {} } });
    const animo = new LiveMoodEngine({ getConfig: () => agente.getConfig().animo });
    const styles: string[] = [];
    const fetchImpl: FetchLike = async (_u, init) => {
      styles.push(JSON.parse(init.body ?? "{}").input?.[0]?.content?.[0]?.annotations?.[0]?.style ?? "");
      return { ok: true, status: 200, text: async () => JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: pcmToWav(Buffer.alloc(4800, 1)).toString("base64") }] }] }) };
    };
    const voice = new VoiceService({ getKey: () => "AIza-test-key-1234", fetchImpl });
    new AgenteController(server, agente, undefined, undefined, voice, animo);
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
    return { send, next, styles, animo };
  }
  const isState = (m: Msg) => m.channel === "agente" && m.payload.kind === "state";

  it("el estado trae el ánimo y animo-test lo sube", async () => {
    const c = await setup();
    const first = await c.next(isState);
    expect(first.payload.animo).toEqual({ energy: 0, level: "calm", mood: "calm", spike: false });
    c.send({ kind: "animo-test" });
    const m = await c.next((x) => isState(x) && x.payload.animo?.spike === true);
    expect(m.payload.animo.mood).toBe("excited");
  });

  it("tts con ánimo automático usa el del LIVE; uno explícito manda sobre él", async () => {
    const c = await setup();
    c.send({ kind: "tts", id: "a", text: "Hola uno" }); // sin mood = auto, LIVE en calma
    await c.next((m) => m.payload.kind === "tts-audio" && m.payload.id === "a");
    c.animo.boost();
    c.send({ kind: "tts", id: "b", text: "Hola dos" }); // auto con subidón → emocionada
    await c.next((m) => m.payload.kind === "tts-audio" && m.payload.id === "b");
    c.send({ kind: "tts", id: "c", text: "Hola tres", mood: "mystery" }); // explícito
    await c.next((m) => m.payload.kind === "tts-audio" && m.payload.id === "c");
    expect(c.styles[0]).not.toContain("entusiasta");
    expect(c.styles[1]).toContain("entusiasta");
    expect(c.styles[2]).toContain("misteriosa");
    expect(c.styles[2]).not.toContain("entusiasta");
  });
});
