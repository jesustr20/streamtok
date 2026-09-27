import { describe, expect, it } from "vitest";
import type { Accion, Evento, EventLogEntry, LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine } from "../src/acciones-eventos-engine.js";
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
    ...overrides,
  };
}

function evento(overrides: Partial<Evento> = {}): Evento {
  return {
    id: "e1",
    activo: true,
    quien: "todos",
    porque: "seguir",
    modoDisparo: "todas",
    accionesIds: ["a1"],
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

  it("modoDisparo unaAlAzar dispara exactamente una acción", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([accion({ id: "a1" }), accion({ id: "a2", nombre: "Otra" })]);
    engine.setEventos([evento({ porque: "seguir", modoDisparo: "unaAlAzar", accionesIds: ["a1", "a2"] })]);

    await engine.handleEvent(followEvent());

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0].action).toBe("arena_join");
  });

  it("evento que referencia una acción borrada → accion-no-encontrada", async () => {
    const bridge = makeBridge();
    const engine = new AccionesEventosEngine(bridge);
    engine.setAcciones([]);
    engine.setEventos([evento({ porque: "seguir", accionesIds: ["borrada"] })]);
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
