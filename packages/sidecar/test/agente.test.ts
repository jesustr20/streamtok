import { describe, expect, it } from "vitest";
import { AgentConfigSchema, parseAgentCommand, type AgentConfig, type LiveEvent } from "@streamtok/shared";
import { AgenteEngine, MAX_ANSWER_CHARS, clampAnswer, showMsFor, type Responder } from "../src/agente.js";

const memStore = (config: Partial<AgentConfig> = {}) => {
  const saved: unknown[] = [];
  return { saved, store: { load: () => ({ config: AgentConfigSchema.parse(config) }), save: async (d: unknown) => void saved.push(d) } };
};

function setup(config: Partial<AgentConfig> = {}, responder?: Responder) {
  let t = 1_000_000;
  const { store, saved } = memStore(config);
  const engine = new AgenteEngine({ store, now: () => t, random: () => 0, responder: responder ?? (async (q) => `R:${q}`) });
  return { engine, saved, advance: (ms: number) => void (t += ms), time: () => t };
}

const comment = (username: string, text: string, e: Partial<LiveEvent> = {}): LiveEvent => ({
  event: "comment",
  username,
  nickname: username.replace("@", "").toUpperCase(),
  text,
  timestamp: 1,
  ...e,
});
const gift = (username: string, coins: number, e: Partial<LiveEvent> = {}): LiveEvent => ({
  event: "gift",
  username,
  giftName: "Rose",
  coins,
  repeatEnd: true,
  timestamp: 1,
  ...e,
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("parseAgentCommand", () => {
  it("devuelve la pregunta sin el comando, sin importar mayúsculas", () => {
    expect(parseAgentCommand("!ia", "!IA ¿qué hora es?")).toBe("¿qué hora es?");
    expect(parseAgentCommand("!ia", "  !ia   hola  ")).toBe("hola");
  });
  it("sin comando o con otra palabra pegada no es para el agente", () => {
    expect(parseAgentCommand("!ia", "hola !ia")).toBeUndefined();
    expect(parseAgentCommand("!ia", "!iapregunta")).toBeUndefined();
    expect(parseAgentCommand("!ia", undefined)).toBeUndefined();
  });
  it("solo el comando = pregunta vacía", () => {
    expect(parseAgentCommand("!ia", "!ia")).toBe("");
  });
});

describe("AgenteEngine: quién puede preguntar", () => {
  it("ignora a quien no cumple ningún requisito", () => {
    const { engine } = setup();
    engine.handleLiveEvent(comment("@ana", "!ia hola"));
    expect(engine.getState().queueSize).toBe(0);
  });

  it("acepta a un seguidor", () => {
    const { engine } = setup();
    engine.handleLiveEvent(comment("@ana", "!ia hola", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(1);
  });

  it("acepta a quien compartió el LIVE", () => {
    const { engine } = setup();
    engine.handleLiveEvent({ event: "share", username: "@ana", timestamp: 1 });
    engine.handleLiveEvent(comment("@ana", "!ia hola"));
    expect(engine.getState().queueSize).toBe(1);
  });

  it("acepta al Fan Club (nivel o regalo Quiéreme)", () => {
    const { engine } = setup();
    engine.handleLiveEvent(comment("@ana", "!ia a", { fanLevel: 2 }));
    engine.handleLiveEvent(gift("@beto", 1, { giftName: "Heart Me" }));
    engine.handleLiveEvent(comment("@beto", "!ia b"));
    expect(engine.getState().queueSize).toBe(2);
  });

  it("acepta a quien mandó un regalo y la pregunta lleva sus monedas", () => {
    const { engine } = setup();
    engine.handleLiveEvent(gift("@ana", 30));
    engine.handleLiveEvent(comment("@ana", "!ia hola"));
    expect(engine.getState().queue[0].coins).toBe(30);
  });

  it("el crédito del regalo caduca y se gasta con la pregunta", () => {
    const { engine, advance } = setup({ giftCreditMin: 1, eligibility: { follow: false, share: false, fanClub: false, gift: true } });
    engine.handleLiveEvent(gift("@ana", 10));
    advance(61_000);
    engine.handleLiveEvent(comment("@ana", "!ia tarde"));
    expect(engine.getState().queueSize).toBe(0);
    engine.handleLiveEvent(gift("@ana", 10));
    engine.handleLiveEvent(comment("@ana", "!ia a tiempo"));
    expect(engine.getState().queueSize).toBe(1);
    engine.tick();
    engine.handleLiveEvent(comment("@ana", "!ia otra"));
    expect(engine.getState().queueSize).toBe(0); // el crédito ya se usó
  });

  it("un requisito apagado no vale", () => {
    const { engine } = setup({ eligibility: { follow: false, share: true, fanClub: true, gift: true } });
    engine.handleLiveEvent(comment("@ana", "!ia hola", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(0);
  });

  it("apagado no atiende", () => {
    const { engine } = setup({ enabled: false });
    engine.handleLiveEvent(comment("@ana", "!ia hola", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(0);
  });

  it("usa el comando configurado y descarta preguntas vacías", () => {
    const { engine } = setup({ command: "!lia" });
    engine.handleLiveEvent(comment("@ana", "!ia hola", { isFollower: true }));
    engine.handleLiveEvent(comment("@ana", "!lia", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(0);
    engine.handleLiveEvent(comment("@ana", "!lia hola", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(1);
  });

  it("una pregunta esperando por persona y corta las muy largas", () => {
    const { engine } = setup({ maxQuestionChars: 20 });
    engine.handleLiveEvent(comment("@ana", `!ia ${"x".repeat(100)}`, { isFollower: true }));
    engine.handleLiveEvent(comment("@ana", "!ia otra", { isFollower: true }));
    const s = engine.getState();
    expect(s.queueSize).toBe(1);
    expect(s.queue[0].question.length).toBeLessThanOrEqual(20);
  });

  it("cada persona espera su enfriamiento antes de volver a preguntar", () => {
    const { engine, advance } = setup({ userCooldownSec: 30 });
    engine.handleLiveEvent(comment("@ana", "!ia uno", { isFollower: true }));
    engine.tick();
    advance(10_000);
    engine.handleLiveEvent(comment("@ana", "!ia dos", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(0);
    advance(21_000);
    engine.handleLiveEvent(comment("@ana", "!ia tres", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(1);
  });

  it("respeta el tamaño máximo de la cola", () => {
    const { engine } = setup({ maxQueue: 5 });
    for (let i = 0; i < 8; i++) engine.handleLiveEvent(comment(`@u${i}`, "!ia hola", { isFollower: true }));
    expect(engine.getState().queueSize).toBe(5);
  });
});

describe("AgenteEngine: prioridad y turnos", () => {
  it("las de regalo pasan primero, más monedas antes, empate por llegada", () => {
    const { engine } = setup();
    engine.handleLiveEvent(comment("@gratis", "!ia g", { isFollower: true }));
    engine.ask("Poco", "p", 5);
    engine.ask("Mucho", "m", 50);
    engine.ask("Mucho2", "m2", 50);
    expect(engine.getState().queue.map((q) => q.name)).toEqual(["Mucho", "Mucho2", "Poco", "GRATIS"]);
  });

  it("combo de regalos: solo se acredita lo nuevo", () => {
    const { engine } = setup();
    engine.handleLiveEvent(gift("@ana", 10, { repeatEnd: false, giftId: 1 }));
    engine.handleLiveEvent(gift("@ana", 30, { repeatEnd: false, giftId: 1 }));
    engine.handleLiveEvent(gift("@ana", 30, { repeatEnd: true, giftId: 1 }));
    engine.handleLiveEvent(comment("@ana", "!ia hola"));
    expect(engine.getState().queue[0].coins).toBe(30);
  });

  it("atiende una gratis, la saca de pantalla a su hora y sigue con la siguiente", async () => {
    const { engine, advance } = setup({ freeEverySec: 30 });
    engine.handleLiveEvent(comment("@g1", "!ia uno", { isFollower: true }));
    engine.handleLiveEvent(comment("@g2", "!ia dos", { isFollower: true }));
    engine.tick(); // nextFreeAt = 0 → sale una gratis
    await settle();
    expect(engine.getState().current?.question).toBe("uno");
    expect(engine.getState().current?.answer).toBe("R:uno");
    advance(3_000);
    engine.tick(); // aún se está leyendo
    expect(engine.getState().current?.question).toBe("uno");
    advance(37_000); // ya se leyó y pasaron los 30 s de la gratis
    engine.tick();
    expect(engine.getState().answered).toBe(1);
    expect(engine.getState().current?.question).toBe("dos");
  });

  it("la gratis no sale antes de tiempo, la de regalo sí", async () => {
    const { engine, advance } = setup({ freeEverySec: 60 });
    engine.ask("A", "a"); // gratis
    engine.tick();
    await settle();
    engine.ask("B", "b"); // gratis
    engine.ask("C", "c", 10); // regalo
    advance(7_000);
    engine.tick(); // sale A de pantalla y entra C (regalo) sin esperar
    await settle();
    expect(engine.getState().current?.question).toBe("c");
    advance(8_000);
    engine.tick(); // sale C; B todavía no (faltan ~45 s)
    expect(engine.getState().current).toBeUndefined();
    expect(engine.getState().queueSize).toBe(1);
    advance(45_000);
    engine.tick();
    expect(engine.getState().current?.question).toBe("b");
  });

  it("mientras piensa muestra la pregunta sin respuesta y recorta la respuesta al tope", async () => {
    let release: (s: string) => void = () => {};
    const { engine } = setup({}, () => new Promise<string>((r) => (release = r)));
    engine.ask("A", "a");
    engine.tick();
    expect(engine.getState().current).toMatchObject({ question: "a", answer: "", showMs: 0 });
    release("y".repeat(900));
    await settle();
    const cur = engine.getState().current!;
    expect(cur.answer.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    expect(cur.showMs).toBeGreaterThan(0);
  });

  it("si el modelo falla, no se enseña nada al público: la pregunta se retira y el motivo queda en el estado", async () => {
    const { engine } = setup({}, async () => {
      throw new Error("sin saldo");
    });
    const logs: string[] = [];
    engine.on("log", (l) => logs.push(l.message));
    engine.ask("A", "a");
    engine.tick();
    await settle();
    expect(engine.getState().current).toBeUndefined();
    expect(engine.getState().lastError?.message).toBe("sin saldo");
    expect(logs[0]).toMatch(/sin saldo/);
  });

  it("si el modelo falla, la pregunta vuelve a la fila una vez (con su prioridad) y a la segunda falla se retira", async () => {
    let calls = 0;
    const { engine, advance } = setup({}, async (q) => {
      if (++calls <= 2) throw new Error("vacía");
      return `R:${q}`;
    });
    engine.ask("A", "a", 7);
    engine.tick();
    await settle();
    expect(engine.getState().current).toBeUndefined();
    expect(engine.getState().queueSize).toBe(1); // volvió a la fila
    expect(engine.getState().queue?.[0]).toMatchObject({ question: "a", coins: 7 });
    advance(1000);
    engine.tick();
    await settle();
    expect(calls).toBe(2);
    expect(engine.getState().queueSize).toBe(0); // la segunda vez ya no vuelve
    expect(engine.getState().current).toBeUndefined();
  });

  it("si el primer intento falla pero el segundo responde, el público solo ve la respuesta", async () => {
    let calls = 0;
    const { engine, advance } = setup({}, async (q) => {
      if (++calls === 1) throw new Error("vacía");
      return `R:${q}`;
    });
    engine.ask("A", "a");
    engine.tick();
    await settle();
    advance(5000);
    engine.tick();
    await settle();
    expect(engine.getState().current).toMatchObject({ question: "a", answer: "R:a" });
  });

  it("reset vacía la cola y la pantalla; una respuesta tardía no reaparece", async () => {
    let release: (s: string) => void = () => {};
    const { engine } = setup({}, () => new Promise<string>((r) => (release = r)));
    engine.ask("A", "a");
    engine.ask("B", "b");
    engine.tick();
    engine.reset();
    release("tarde");
    await settle();
    const s = engine.getState();
    expect(s.queueSize).toBe(0);
    expect(s.current).toBeUndefined();
  });

  it("resetSession olvida quién cumplía los requisitos", () => {
    const { engine } = setup();
    engine.handleLiveEvent(comment("@ana", "!ia a", { isFollower: true }));
    engine.resetSession();
    engine.handleLiveEvent(comment("@ana", "!ia b"));
    expect(engine.getState().queueSize).toBe(0);
  });

  it("guarda la configuración", async () => {
    const { engine, saved } = setup();
    engine.save(AgentConfigSchema.parse({ name: "Luna", command: "!luna" }));
    await engine.flush();
    expect(saved).toHaveLength(1);
    expect(engine.getConfig().name).toBe("Luna");
  });
});

describe("showMsFor", () => {
  it("entre 6 y 45 segundos", () => {
    expect(showMsFor("hola")).toBe(6000);
    expect(showMsFor("x".repeat(150))).toBe(13500);
    expect(showMsFor("x".repeat(1000))).toBe(45000);
  });
});

describe("clampAnswer", () => {
  it("una respuesta de varias frases (más de 150 letras) sale entera", () => {
    const a = "Los pulpos tienen tres corazones. Dos bombean sangre a las branquias y uno al resto del cuerpo. Además, su sangre es azul porque usa cobre en vez de hierro para transportar el oxígeno, y por eso les va mejor en aguas frías.";
    expect(a.length).toBeGreaterThan(200);
    expect(clampAnswer(a)).toBe(a);
  });
  it("si se pasa del tope corta en el final de una frase, sin dejarla a medias", () => {
    const frase = "Esta es una frase de relleno bastante larga. ";
    const r = clampAnswer(frase.repeat(30));
    expect(r.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    expect(r.endsWith(".")).toBe(true);
  });
  it("sin puntos corta con «…»", () => {
    const r = clampAnswer("y".repeat(900));
    expect(r.length).toBe(MAX_ANSWER_CHARS);
    expect(r.endsWith("…")).toBe(true);
  });
});
