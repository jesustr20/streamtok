import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Accion, Evento, EventLogEntry, LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine, computeGifterRank, describeLiveEvent } from "../src/acciones-eventos-engine.js";
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

  it("repetir:true cuenta CADA regalo del combo: 1,3,4,5 + cierre 5 = 5 ejecuciones", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);
    const msg = (repeatCount: number, repeatEnd: boolean) =>
      engine.handleEvent({ event: "gift", username: "@fan", giftId: 5655, giftName: "Rose", coins: repeatCount, repeatCount, repeatEnd, timestamp: 0 });

    await msg(1, false);
    await msg(3, false);
    await msg(4, false);
    await msg(5, false);
    await msg(5, true);

    expect(bridge.calls).toHaveLength(5);
  });

  it("una sola rosa (en curso + cierre) con repetir:true se ejecuta UNA vez, no dos", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);

    await engine.handleEvent({ event: "gift", username: "@fan", giftId: 5655, giftName: "Rose", coins: 1, repeatCount: 1, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftId: 5655, giftName: "Rose", coins: 1, repeatCount: 1, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
  });

  it("sin repeatCount (fuente vieja) una rosa en curso + cierre sigue siendo 1 ejecución", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
  });

  it("repetir:true: si los mensajes en curso no llegaron, el cierre ejecuta el total", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 3, repeatCount: 3, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(3);
  });

  it("dos streaks seguidos de la misma persona se cuentan por separado", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);
    const gift = (repeatCount: number, repeatEnd: boolean) =>
      engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: repeatCount, repeatCount, repeatEnd, timestamp: 0 });

    await gift(1, false);
    await gift(2, false);
    await gift(2, true);
    await gift(1, false);
    await gift(1, true);

    expect(bridge.calls).toHaveLength(3);
  });

  it("si el cierre de un streak se perdió, un streak nuevo (cantidad menor) no queda contaminado", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);
    const gift = (repeatCount: number, repeatEnd: boolean) =>
      engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: repeatCount, repeatCount, repeatEnd, timestamp: 0 });

    await gift(1, false);
    await gift(3, false); // streak A (sin cierre)
    await gift(1, false); // streak B empieza: la cantidad bajó
    await gift(2, false);

    expect(bridge.calls).toHaveLength(5); // 1 + 2 (A) + 1 + 1 (B)
  });

  it("regalo sin repeatEnd (simulador) con repetir:true: una ejecución por regalo, sin quedarse con estado", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true })]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, timestamp: 0 });

    expect(bridge.calls).toHaveLength(2);
  });

  it("una rosa con repetir:false (por defecto) también se ejecuta una sola vez", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Rose" })]);

    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatCount: 1, repeatEnd: false, timestamp: 0 });
    await engine.handleEvent({ event: "gift", username: "@fan", giftName: "Rose", coins: 1, repeatCount: 1, repeatEnd: true, timestamp: 0 });

    expect(bridge.calls).toHaveLength(1);
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

  it("likes: el acumulado es por usuario, no global", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "likes", cantidadMinimaLikes: 3 })]);
    const { entries } = collect(engine);

    // 2 likes de @ana y 2 de @beto: nadie llega a 3 (global serían 4).
    for (const u of ["@ana", "@beto", "@ana", "@beto"]) {
      await engine.handleEvent({ event: "like", username: u, nickname: u.slice(1), timestamp: 0 });
    }
    expect(bridge.calls).toHaveLength(0);
    expect(entries.map((e) => e.message)).toEqual(["ana: 1/3 likes", "beto: 1/3 likes", "ana: 2/3 likes", "beto: 2/3 likes"]);

    // el 3.º de @ana dispara, y con su nameTag
    await engine.handleEvent({ event: "like", username: "@ana", nickname: "Ana", timestamp: 0 });
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].opts?.nameTag).toBe("Ana");
  });

  it("likes: suma los taps de likeCount y dispara una vez por cada N completo", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "likes", cantidadMinimaLikes: 20 })]);
    const { entries } = collect(engine);

    await engine.handleEvent({ event: "like", username: "@ana", nickname: "Ana", likeCount: 15, timestamp: 0 });
    expect(bridge.calls).toHaveLength(0);
    expect(entries[0].message).toBe("Ana: 15/20 likes");

    // 15 + 15 = 30 → cruza 20 una vez; quedan 10 acumulados
    await engine.handleEvent({ event: "like", username: "@ana", nickname: "Ana", likeCount: 15, timestamp: 0 });
    expect(bridge.calls).toHaveLength(1);

    await engine.handleEvent({ event: "like", username: "@ana", nickname: "Ana", likeCount: 10, timestamp: 0 });
    expect(bridge.calls).toHaveLength(2);

    // un mensaje grande cruza varias veces: 45 taps con N=20 → 2 disparos
    await engine.handleEvent({ event: "like", username: "@beto", nickname: "Beto", likeCount: 45, timestamp: 0 });
    expect(bridge.calls).toHaveLength(4);
  });

  it("likes: resetSession reinicia los acumulados", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "likes", cantidadMinimaLikes: 20 })]);

    await engine.handleEvent({ event: "like", username: "@ana", likeCount: 15, timestamp: 0 });
    engine.resetSession();
    await engine.handleEvent({ event: "like", username: "@ana", likeCount: 15, timestamp: 0 });

    expect(bridge.calls).toHaveLength(0);
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

describe("AccionesEventosEngine — nameTag en el modo Carrera", () => {
  it.each(["race_join", "race_boost", "race_rose"])(
    "%s manda nameTag (display name) aunque el catálogo no lo declare",
    async (modActionId) => {
      const bridge = makeBridge();
      const engine = new AccionesEventosEngine(bridge);
      engine.setAcciones([accion({ comandos: [{ modActionId, params: {} }] })]);
      engine.setEventos([evento({ porque: "seguir" })]);

      await engine.handleEvent(followEvent());

      expect(bridge.calls[0].action).toBe(modActionId);
      expect(bridge.calls[0].opts?.nameTag).toBe("Fan 123");
    },
  );

  it("race_start (acción del streamer) no manda nameTag si el catálogo no lo pide", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ comandos: [{ modActionId: "race_start", params: {} }] })]);
    engine.setEventos([evento({ porque: "seguir" })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls[0].opts?.nameTag).toBeUndefined();
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

describe("mensajes del log del motor", () => {
  const heart: LiveEvent = {
    event: "gift",
    username: "@satoru",
    nickname: "Satoru",
    giftName: "Heart",
    giftId: 5576,
    coins: 10,
    repeatEnd: true,
    timestamp: 0,
  };

  it("describeLiveEvent: regalo con nombre, id, monedas y quién; otros eventos con su etiqueta", () => {
    expect(describeLiveEvent(heart)).toBe("regalo Heart (id 5576, 10 monedas) de Satoru");
    expect(describeLiveEvent({ ...heart, giftId: undefined, coins: undefined, nickname: undefined })).toBe(
      "regalo Heart de @satoru",
    );
    expect(describeLiveEvent(followEvent())).toMatch(/de Fan 123$/);
  });

  it("regalo sin evento que coincida: el descarte dice qué regalo llegó", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "LIVE Island" })]);
    const { entries } = collect(engine);

    await engine.handleEvent(heart);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "discarded", reason: "no-match" });
    expect(entries[0].message).toBe("sin evento que coincida con regalo Heart (id 5576, 10 monedas) de Satoru");
  });

  it("regalo que dispara: el log dice qué regalo y qué acción salió", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    engine.setAcciones([accion({ comandos: [{ modActionId: "earthquake", params: {} }] })]);
    engine.setEventos([evento({ id: "ev-heart", porque: "regaloEspecifico", giftId: "5576", giftName: "Heart" })]);
    const { entries } = collect(engine);

    await engine.handleEvent(heart);

    expect(entries.filter((e) => e.status === "fired")).toHaveLength(1);
    const fired = entries.find((e) => e.status === "fired")!;
    expect(fired.eventoId).toBe("ev-heart");
    expect(fired.message).toBe("regalo Heart (id 5576, 10 monedas) de Satoru → earthquake");
  });
});

describe("AccionesEventosEngine — cooldown (ADR 0010)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T20:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const follow = (username: string): LiveEvent => ({ event: "follow", username, nickname: username, timestamp: 0 });

  function setup(acc: Partial<Accion>, bridge = makeBridge()) {
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion(acc)]);
    engine.setEventos([evento({ porque: "seguir" })]);
    const { entries } = collect(engine);
    return { engine, bridge, entries };
  }

  it("sin cooldown (0 o ausente): se dispara siempre", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 0, cooldownUsuarioSeg: 0 });
    await engine.handleEvent(follow("@a"));
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls).toHaveLength(2);
  });

  it("global: tras ejecutarse nadie puede usarla hasta que pase el tiempo", async () => {
    const { engine, bridge, entries } = setup({ cooldownGlobalSeg: 60 });
    await engine.handleEvent(follow("@a"));
    await engine.handleEvent(follow("@b")); // otro usuario, igual bloqueado
    expect(bridge.calls).toHaveLength(1);
    const blocked = entries.find((e) => e.reason === "cooldown");
    expect(blocked?.status).toBe("discarded");
    expect(blocked?.message).toContain("global");

    vi.advanceTimersByTime(59_000);
    await engine.handleEvent(follow("@b"));
    expect(bridge.calls).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    await engine.handleEvent(follow("@b"));
    expect(bridge.calls).toHaveLength(2);
  });

  it("por usuario: solo bloquea a quien la usó; cada usuario tiene su propio tiempo", async () => {
    const { engine, bridge } = setup({ cooldownUsuarioSeg: 600 });
    await engine.handleEvent(follow("@a")); // t=0: a ejecuta
    await engine.handleEvent(follow("@a")); // bloqueado
    await engine.handleEvent(follow("@b")); // b no está afectado: ejecuta
    expect(bridge.calls).toHaveLength(2);

    vi.advanceTimersByTime(300_000); // t=300 s
    await engine.handleEvent(follow("@c")); // c ejecuta; su cooldown termina en t=900 s
    expect(bridge.calls).toHaveLength(3);

    vi.advanceTimersByTime(300_000); // t=600 s: a y b cumplieron, c no
    await engine.handleEvent(follow("@a"));
    await engine.handleEvent(follow("@b"));
    await engine.handleEvent(follow("@c"));
    expect(bridge.calls).toHaveLength(5);

    vi.advanceTimersByTime(300_000); // t=900 s: c cumple
    await engine.handleEvent(follow("@c"));
    expect(bridge.calls).toHaveLength(6);
  });

  it("por usuario: se identifica por @username, no por el nombre visible", async () => {
    const { engine, bridge } = setup({ cooldownUsuarioSeg: 600 });
    await engine.handleEvent({ event: "follow", username: "@Ana", nickname: "Ana 1", timestamp: 0 });
    await engine.handleEvent({ event: "follow", username: "ana", nickname: "Otro nombre", timestamp: 0 });
    expect(bridge.calls).toHaveLength(1);
  });

  it("ambos: debe cumplirse el global Y el del usuario", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 10, cooldownUsuarioSeg: 100 });
    await engine.handleEvent(follow("@a"));
    vi.advanceTimersByTime(10_000);
    await engine.handleEvent(follow("@a")); // global libre, pero @a sigue en el suyo
    await engine.handleEvent(follow("@b")); // global libre y @b no tiene cooldown
    expect(bridge.calls).toHaveLength(2);
    await engine.handleEvent(follow("@c")); // global recién reiniciado por @b
    expect(bridge.calls).toHaveLength(2);
  });

  it("el intento bloqueado deja una entrada con reason cooldown y los segundos que faltan", async () => {
    const { engine, entries } = setup({ cooldownUsuarioSeg: 90, nombre: "Atacar" });
    await engine.handleEvent(follow("@a"));
    vi.advanceTimersByTime(30_000);
    await engine.handleEvent(follow("@a"));
    const blocked = entries.find((e) => e.reason === "cooldown")!;
    expect(blocked.message).toContain("Atacar");
    expect(blocked.message).toContain("60");
    expect(blocked.accionId).toBe("a1");
  });

  it("si el mod rechaza todos los comandos, el cooldown no se queda activado", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 60 }, makeBridge("Mod no conectado"));
    await engine.handleEvent(follow("@a"));
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls).toHaveLength(2); // el segundo intento no estaba bloqueado
  });

  it("dos eventos casi simultáneos: solo pasa uno (se reserva antes de enviar)", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 60 });
    await Promise.all([engine.handleEvent(follow("@a")), engine.handleEvent(follow("@b"))]);
    expect(bridge.calls).toHaveLength(1);
  });

  it("resetSession (reconexión al LIVE) lo pone todo en 0", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 600, cooldownUsuarioSeg: 600 });
    await engine.handleEvent(follow("@a"));
    engine.resetSession();
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls).toHaveLength(2);
  });

  it("editar la acción reinicia su cooldown solo si cambiaron los segundos", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 600 });
    await engine.handleEvent(follow("@a"));
    engine.setAcciones([accion({ cooldownGlobalSeg: 600, nombre: "Otro nombre" })]);
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls).toHaveLength(1); // mismo cooldown: sigue bloqueada

    engine.setAcciones([accion({ cooldownGlobalSeg: 5 })]);
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls).toHaveLength(2); // cambió: arranca de cero
  });

  it("cada acción tiene su propio cooldown", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([
      accion({ id: "a1", cooldownGlobalSeg: 600 }),
      accion({ id: "a2", comandos: [{ modActionId: "otra", params: {} }] }),
    ]);
    engine.setEventos([evento({ porque: "seguir", accionesTodas: ["a1", "a2"] })]);
    await engine.handleEvent(follow("@a"));
    await engine.handleEvent(follow("@a"));
    expect(bridge.calls.map((c) => c.action)).toEqual(["arena_join", "otra", "otra"]);
  });

  it("repetir con combo: el cooldown corta las repeticiones y lo bloqueado no se ejecuta en bloque después", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ repetirConComboDeRegalos: true, cooldownUsuarioSeg: 5 })]);
    engine.setEventos([evento({ porque: "regaloValorMinimo", valorMinimoMonedas: 1 })]);
    const gift = (repeatCount: number, repeatEnd: boolean): LiveEvent => ({
      event: "gift", username: "@a", coins: 1, giftId: "5655", repeatCount, repeatEnd, timestamp: 0,
    });
    await engine.handleEvent(gift(1, false)); // ejecuta 1 y arranca el cooldown
    await engine.handleEvent(gift(3, false)); // bloqueado: se descartan 2 regalos
    vi.advanceTimersByTime(6_000);
    await engine.handleEvent(gift(3, true)); // cierre: ya estaban contados, no se ejecutan
    expect(bridge.calls).toHaveLength(1);
  });

  it("el simulador (mismo handleEvent) también respeta el cooldown", async () => {
    const { engine, bridge } = setup({ cooldownGlobalSeg: 30 });
    await engine.handleEvent({ ...follow("@sim"), timestamp: 123 });
    await engine.handleEvent({ ...follow("@sim"), timestamp: 124 });
    expect(bridge.calls).toHaveLength(1);
  });
});

describe("AccionesEventosEngine — regalo específico con nombres repetidos", () => {
  const gift = (giftName: string, giftId?: number): LiveEvent => ({
    event: "gift", username: "@fan", giftName, giftId, coins: 10, repeatEnd: true, timestamp: 0,
  });

  it("con id guardado manda el id: otro regalo con el MISMO nombre y distinto id no dispara", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftId: "14087", giftName: "Balloons" })]);
    const { entries } = collect(engine);

    await engine.handleEvent(gift("Balloons", 15099));
    expect(bridge.calls).toHaveLength(0);
    expect(entries[0].reason).toBe("no-match");

    await engine.handleEvent(gift("Balloons", 14087));
    expect(bridge.calls).toHaveLength(1);
  });

  it("con id guardado y regalo sin id (simulador antiguo): cae al nombre", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftId: "14087", giftName: "Balloons" })]);
    await engine.handleEvent(gift("Balloons"));
    expect(bridge.calls).toHaveLength(1);
  });

  it("evento solo con nombre (sin id): sigue disparando por nombre con cualquier id", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftName: "Balloons" })]);
    await engine.handleEvent(gift("Balloons", 15099));
    await engine.handleEvent(gift("Balloons", 14087));
    expect(bridge.calls).toHaveLength(2);
  });

  it("con id guardado: si TikTok renombra el regalo, sigue disparando por id", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion()]);
    engine.setEventos([evento({ porque: "regaloEspecifico", giftId: "5879", giftName: "Doughnut" })]);
    await engine.handleEvent(gift("Donut", 5879));
    expect(bridge.calls).toHaveLength(1);
  });
});

describe("comandos internos de la app (ADR 0011)", () => {
  function counters() {
    const applied: Array<{ id: string; params: Record<string, unknown> }> = [];
    return {
      applied,
      applyAppCommand(id: string, params: Record<string, unknown>) {
        applied.push({ id, params });
        return id === "app.mala" ? ({ ok: false, error: "no existe" } as const) : ({ ok: true } as const);
      },
    };
  }

  it("un comando app.* lo ejecuta el motor de contadores y NO se manda al mod", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    const c = counters();
    engine.setCounters(c);
    engine.setAcciones([accion({ comandos: [{ modActionId: "app.timer.add", params: { seconds: -60 } }] })]);
    engine.setEventos([evento()]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(c.applied).toEqual([{ id: "app.timer.add", params: { seconds: -60 } }]);
    expect((bridge as unknown as { calls: Call[] }).calls).toEqual([]);
    expect(entries.map((e) => e.status)).toEqual(["fired"]);
    expect(entries[0].action).toBe("app.timer.add");
  });

  it("una acción puede mezclar comandos del mod y comandos internos", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    const c = counters();
    engine.setCounters(c);
    engine.setAcciones([
      accion({
        comandos: [
          { modActionId: "arena_join", params: { character: "default" } },
          { modActionId: "app.wins.add", params: { amount: 1 } },
        ],
      }),
    ]);
    engine.setEventos([evento()]);

    await engine.handleEvent(followEvent());

    expect((bridge as unknown as { calls: Call[] }).calls.map((x) => x.action)).toEqual(["arena_join"]);
    expect(c.applied.map((x) => x.id)).toEqual(["app.wins.add"]);
  });

  it("si el comando interno falla, queda descartado en el log", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    engine.setCounters(counters());
    engine.setAcciones([accion({ comandos: [{ modActionId: "app.mala", params: {} }] })]);
    engine.setEventos([evento()]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries[0]).toMatchObject({ status: "discarded", action: "app.mala" });
    expect(entries[0].message).toContain("no existe");
  });

  it("sin motor de contadores conectado, el comando interno se descarta sin romper", async () => {
    const engine = new AccionesEventosEngine(makeBridge());
    engine.setAcciones([accion({ comandos: [{ modActionId: "app.wins.add", params: { amount: 1 } }] })]);
    engine.setEventos([evento()]);
    const { entries } = collect(engine);

    await engine.handleEvent(followEvent());

    expect(entries[0]).toMatchObject({ status: "discarded", action: "app.wins.add" });
  });

  it("runAcciones ejecuta acciones por id (p. ej. 'al expirar' del timer), ignorando eventos y cooldown", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setCounters(counters());
    engine.setAcciones([
      accion({ id: "x", cooldownGlobalSeg: 999, comandos: [{ modActionId: "arena_join", params: { character: "default" } }] }),
    ]);
    const { entries } = collect(engine);

    await engine.runAcciones(["x", "x", "borrada"], "timer-expired");

    expect((bridge as unknown as { calls: Call[] }).calls).toHaveLength(2);
    expect(entries.filter((e) => e.status === "fired")).toHaveLength(2);
    expect(entries.some((e) => e.status === "discarded" && e.message.includes("borrada"))).toBe(true);
  });
});
