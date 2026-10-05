import { describe, expect, it } from "vitest";
import type { Accion, Evento, EventLogEntry, LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine, computeGifterRank } from "../src/acciones-eventos-engine.js";
import type { ModBridge } from "../src/mod-bridge.js";

type Call = {
  action: string;
  params: Record<string, number | string | boolean>;
  opts?: { nameTag?: string; notify?: string };
};

function makeBridge(ackError?: string) {
  const calls: Call[] = [];
  const bridge = {
    calls,
    async sendCommand(
      action: string,
      params: Record<string, number | string | boolean>,
      opts?: { nameTag?: string; notify?: string },
    ) {
      calls.push({ action, params, opts });
      if (ackError !== undefined) return { id: "id", ok: false, error: ackError };
      return { id: "id", ok: true };
    },
    getAction() {
      return undefined;
    },
  };
  return bridge as unknown as ModBridge;
}

function accion(overrides: Partial<Accion> = {}): Accion {
  return {
    id: "a1",
    nombre: "Atacar",
    descripcion: "",
    duracionSeg: 0,
    puntos: 0,
    pantalla: null,
    media: { animacion: false, imagen: false, sonido: false, video: false },
    comandos: [{ modActionId: "arena_join", params: { character: "default" } }],
    repetirConComboDeRegalos: false,
    ...overrides,
  };
}

function evento(overrides: Partial<Evento> = {}): Evento {
  return {
    id: "e1",
    activo: true,
    quien: "todos",
    porque: "seguir",
    accionesTodas: ["a1"],
    accionesAleatorias: [],
    ...overrides,
  };
}

function collect(engine: AccionesEventosEngine): { entries: EventLogEntry[] } {
  const entries: EventLogEntry[] = [];
  engine.on("event-log", (e) => entries.push(e as EventLogEntry));
  return { entries };
}

function followEvent(): LiveEvent {
  return { event: "follow", username: "@fan", nickname: "Fan 123", timestamp: 0 };
}

function giftEvent(username: string, coins: number, nickname?: string): LiveEvent {
  return { event: "gift", username, nickname, coins, repeatEnd: true, timestamp: 0 };
}

function emoteEvent(username: string, emoteId: string, emoteScene: "subscriber" | "fanClub"): LiveEvent {
  return { event: "emote", username, emoteId, emoteScene, timestamp: 0 };
}

describe("AccionesEventosEngine — matching", () => {
  it("dispara la acción del evento que coincide", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir" })]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(bridge.calls.map((c) => c.action)).toEqual(["arena_join"]);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("fired");
    expect(entries[0].accionId).toBe("a1");
    expect(entries[0].eventoId).toBe("e1");
  });

  it("evento inactivo no dispara", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir", activo: false })]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(0);
    expect(entries[0].reason).toBe("no-match");
  });

  it("sin coincidencia → descarte no-match", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "join", username: "@fan", timestamp: 0 });

    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("no-match");
  });

  it("regalo en mitad de streak → gift-in-progress", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "gift", username: "@fan", repeatEnd: false, timestamp: 0 });

    expect(entries[0].reason).toBe("gift-in-progress");
  });

  it("repetirConComboDeRegalos:true dispara en cada evento del combo (incl. intermedios)", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 2, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 3, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(3);
    expect(entries.filter((e) => e.status === "fired")).toHaveLength(3);
    expect(entries.filter((e) => e.reason === "gift-in-progress")).toHaveLength(0);
  });

  it("repetirConComboDeRegalos:false (o ausente) solo dispara al cierre del combo", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: false })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 2, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 3, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
    expect(entries.filter((e) => e.status === "fired")).toHaveLength(1);
    expect(entries.filter((e) => e.reason === "gift-in-progress")).toHaveLength(2);
  });

  it("una acción con varios comandos envía todos", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([
      accion({
        comandos: [
          { modActionId: "arena_join", params: {} },
          { modActionId: "vehicle_spawn", params: { amount: 1 } },
        ],
      }),
    ]);
    engine.setEventos([evento({ porque: "seguir" })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls.map((c) => c.action)).toEqual(["arena_join", "vehicle_spawn"]);
  });

  it("solo accionesAleatorias dispara exactamente una acción", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ id: "a1" }), accion({ id: "a2", nombre: "Otra" })]);
    engine.setEventos([evento({ porque: "seguir", accionesTodas: [], accionesAleatorias: ["a1", "a2"] })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].action).toBe("arena_join");
  });

  it("evento que referencia una acción borrada → accion-no-encontrada", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([]);
    engine.setEventos([evento({ porque: "seguir", accionesTodas: ["borrada"], accionesAleatorias: [] })]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("accion-no-encontrada");
  });

  it("comando fallido por mod no conectado → mod-not-connected", async () => {
    const engine = new AccionesEventosEngine(makeBridge("Mod no conectado"));
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir" })]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries[0].status).toBe("discarded");
    expect(entries[0].reason).toBe("mod-not-connected");
  });

  it("likes: dispara cada N likes", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "likes", cantidadMinimaLikes: 3 })]);
    const { entries } = collect(engine);

    for (let i = 0; i < 7; i++) {
      await engine.handleEvent({ event: "like", username: "@fan", timestamp: 0 });
    }

    // dispara en el like #3 y #6 → 2 commands; likes 1,2,4,5,7 → like-threshold
    expect(bridge.calls).toHaveLength(2);
    expect(entries.filter((e) => e.status === "fired")).toHaveLength(2);
    expect(entries.filter((e) => e.reason === "like-threshold")).toHaveLength(5);
  });

  it("comando (porque) coincide por prefijo del texto", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "comando", comando: "!carro" })]);

    await engine.handleEvent({
      event: "comment",
      username: "@fan",
      text: "!carro ahora",
      timestamp: 0,
    });

    expect(bridge.calls).toHaveLength(1);
  });

  it("quien usuarioEspecifico coincide por handle", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir", quien: "usuarioEspecifico", usuarioEspecifico: "fan" })]);

    await engine.handleEvent({ event: "follow", username: "@fan", timestamp: 0 });
    await engine.handleEvent({ event: "follow", username: "@otro", timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
  });

  it("arena_* fuerza nameTag (display name, nunca @username)", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir" })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls[0].opts?.nameTag).toBe("Fan 123");
  });
});

describe("AccionesEventosEngine — quien con metadata (issue #23)", () => {
  it("quien seguidor coincide cuando la fuente reporta isFollower", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir", quien: "seguidor" })]);

    await engine.handleEvent({ event: "follow", username: "@fan", isFollower: true, timestamp: 0 });
    await engine.handleEvent({ event: "follow", username: "@otro", isFollower: false, timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].opts?.nameTag).toBe("@fan");
  });

  it("quien suscriptor coincide cuando la fuente reporta isSubscriber", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir", quien: "suscriptor" })]);

    await engine.handleEvent({ event: "follow", username: "@sub", isSubscriber: true, timestamp: 0 });
    await engine.handleEvent({ event: "follow", username: "@nadie", timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
  });

  it("quien moderador coincide cuando la fuente reporta isModerator", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "seguir", quien: "moderador" })]);

    await engine.handleEvent({ event: "follow", username: "@mod", isModerator: true, timestamp: 0 });
    await engine.handleEvent({ event: "follow", username: "@otro", timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
  });

  it("quien donanteTop coincide con el top N de la sesión", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloValorMinimo", quien: "donanteTop", numeroDonantesTop: 2 })]);

    await engine.handleEvent(giftEvent("@a", 100, "A")); // rank 1 → top 2 → dispara
    await engine.handleEvent(giftEvent("@b", 300, "B")); // rank 1 → dispara
    await engine.handleEvent(giftEvent("@c", 500, "C")); // rank 1 → dispara
    await engine.handleEvent(giftEvent("@a", 10, "A")); // ahora A = 110 → rank 3 → no dispara

    expect(bridge.calls).toHaveLength(3);
    expect(bridge.calls.map((c) => c.opts?.nameTag)).toEqual(["A", "B", "C"]);
  });

  it("porque emoteSuscriptor coincide con un emote de suscriptor por id", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "emoteSuscriptor", emoteId: "sub_emote_1" })]);

    await engine.handleEvent(emoteEvent("@sub", "sub_emote_1", "subscriber"));
    await engine.handleEvent(emoteEvent("@sub", "sub_emote_1", "fanClub")); // escena equivocada
    await engine.handleEvent(emoteEvent("@sub", "otro", "subscriber")); // id distinto

    expect(bridge.calls).toHaveLength(1);
  });

  it("porque stickerFanClub coincide con un sticker del Fan Club por id", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "stickerFanClub", stickerId: "sticker_1" })]);

    await engine.handleEvent(emoteEvent("@fan", "sticker_1", "fanClub"));
    await engine.handleEvent(emoteEvent("@fan", "sticker_1", "subscriber")); // escena equivocada

    expect(bridge.calls).toHaveLength(1);
  });

  it("primeraActividad y compraTiktokShop siguen sin coincidir (sin señal en la fuente)", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "primeraActividad" }), evento({ porque: "compraTiktokShop", nombreProductoContiene: "x" })]);

    await engine.handleEvent({ event: "join", username: "@fan", timestamp: 0 });

    expect(bridge.calls).toHaveLength(0);
  });
});

describe("AccionesEventosEngine — accionesTodas / accionesAleatorias", () => {
  it("solo accionesTodas: ejecuta todas", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ id: "a1" }), accion({ id: "a2", nombre: "Otra" })]);
    engine.setEventos([evento({ accionesTodas: ["a1", "a2"], accionesAleatorias: [] })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(2);
    expect(bridge.calls.map((c) => c.action)).toEqual(["arena_join", "arena_join"]);
  });

  it("solo accionesAleatorias: ejecuta exactamente una", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ id: "a1" }), accion({ id: "a2", nombre: "Otra" })]);
    engine.setEventos([evento({ accionesTodas: [], accionesAleatorias: ["a1", "a2"] })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].action).toBe("arena_join");
  });

  it("ambas: ejecuta todas las fijas más una aleatoria", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([
      accion({ id: "a1" }),
      accion({ id: "a2", nombre: "Otra" }),
      accion({ id: "a3", nombre: "Tercera" }),
    ]);
    engine.setEventos([evento({ accionesTodas: ["a1", "a2"], accionesAleatorias: ["a3"] })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(3);
    expect(bridge.calls.map((c) => c.action)).toEqual(["arena_join", "arena_join", "arena_join"]);
  });

  it("ambas vacías: no ejecuta nada", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ accionesTodas: [], accionesAleatorias: [] })]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });
});

describe("computeGifterRank", () => {
  it("calcula ranking denso (empates comparten posición)", () => {
    const totals = new Map<string, number>([
      ["a", 100],
      ["b", 300],
      ["c", 300],
    ]);

    expect(computeGifterRank(totals, "@c")).toBe(1);
    expect(computeGifterRank(totals, "b")).toBe(1);
    expect(computeGifterRank(totals, "a")).toBe(2);
  });

  it("devuelve null para usuarios sin monedas o desconocidos", () => {
    expect(computeGifterRank(new Map([["a", 0]]), "a")).toBeNull();
    expect(computeGifterRank(new Map(), "a")).toBeNull();
    expect(computeGifterRank(new Map([["a", 100]]), "b")).toBeNull();
  });
});

describe("AccionesEventosEngine — niveles (ADR 0007)", () => {
  async function run(ev: Partial<Evento>, live: LiveEvent) {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento(ev)]);
    await engine.handleEvent(live);
    return bridge.calls.length;
  }

  it("subeNivelFan dispara con fanLevelUp (nivelMinimo por defecto 1)", async () => {
    const live: LiveEvent = { event: "fanLevelUp", username: "@ana", previousLevel: 1, newLevel: 2, timestamp: 0 };
    expect(await run({ porque: "subeNivelFan" }, live)).toBe(1);
  });

  it("subeNivelFan no dispara con donorLevelUp ni con otros eventos", async () => {
    expect(await run({ porque: "subeNivelFan" }, { event: "donorLevelUp", username: "@ana", newLevel: 8, timestamp: 0 })).toBe(0);
    expect(await run({ porque: "subeNivelFan" }, followEvent())).toBe(0);
  });

  it("subeNivelDonador dispara con donorLevelUp y respeta nivelMinimo", async () => {
    const up = (newLevel: number): LiveEvent => ({ event: "donorLevelUp", username: "@ana", previousLevel: newLevel - 1, newLevel, timestamp: 0 });
    expect(await run({ porque: "subeNivelDonador" }, up(2))).toBe(1);
    expect(await run({ porque: "subeNivelDonador", nivelMinimo: 10 }, up(9))).toBe(0);
    expect(await run({ porque: "subeNivelDonador", nivelMinimo: 10 }, up(10))).toBe(1);
  });

  it("subeNivel sin newLevel (dato ausente) con nivelMinimo > 1 no dispara", async () => {
    expect(await run({ porque: "subeNivelDonador", nivelMinimo: 5 }, { event: "donorLevelUp", username: "@ana", timestamp: 0 })).toBe(0);
  });

  it("nivelEquipoRequerido se compara con fanLevel en unirse", async () => {
    const join = (fanLevel?: number): LiveEvent => ({ event: "join", username: "@ana", fanLevel, timestamp: 0 });
    const ev = { porque: "unirse", nivelEquipoRequerido: 5 } as const;
    expect(await run(ev, join(6))).toBe(1);
    expect(await run(ev, join(5))).toBe(1);
    expect(await run(ev, join(3))).toBe(0);
    expect(await run(ev, join(undefined))).toBe(0); // desconocido = no coincide
  });

  it("nivelEquipoRequerido 0 (o ausente) no filtra: se comporta como antes", async () => {
    const join: LiveEvent = { event: "join", username: "@ana", timestamp: 0 };
    expect(await run({ porque: "unirse", nivelEquipoRequerido: 0 }, join)).toBe(1);
    expect(await run({ porque: "unirse" }, join)).toBe(1);
  });

  it("nivelEquipoRequerido también filtra comandos", async () => {
    const cmd = (fanLevel?: number): LiveEvent => ({ event: "comment", username: "@ana", text: "!drop", fanLevel, timestamp: 0 });
    const ev = { porque: "comando", comando: "!drop", nivelEquipoRequerido: 2 } as const;
    expect(await run(ev, cmd(2))).toBe(1);
    expect(await run(ev, cmd(1))).toBe(0);
  });

  it("donanteTop usa topGifterRank de TikTok cuando viene", async () => {
    const chat = (topGifterRank?: number): LiveEvent => ({ event: "comment", username: "@ana", text: "hola", topGifterRank, timestamp: 0 });
    const ev = { quien: "donanteTop", numeroDonantesTop: 3, porque: "chat" } as const;
    expect(await run(ev, chat(2))).toBe(1);
    expect(await run(ev, chat(3))).toBe(1);
    expect(await run(ev, chat(5))).toBe(0);
  });

  it("donanteTop sin topGifterRank sigue usando el ranking por monedas de la sesión", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ quien: "donanteTop", numeroDonantesTop: 1, porque: "chat" })]);
    await engine.handleEvent(giftEvent("@rico", 500));
    await engine.handleEvent({ event: "comment", username: "@rico", text: "hola", timestamp: 0 });
    expect(bridge.calls).toHaveLength(1);
  });
});
