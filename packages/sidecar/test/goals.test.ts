import { describe, expect, it, vi } from "vitest";
import { GOAL_PRESETS, GOAL_ROTATION_ID, GoalConfigSchema, type Goal, type GoalConfig, type LiveEvent } from "@streamtok/shared";
import { GoalsEngine, type PersistedGoals } from "../src/goals.js";

function memoryStore(initial: PersistedGoals = { goals: [], seeded: false }) {
  const saved: PersistedGoals[] = [];
  return {
    saved,
    load: () => initial,
    save: async (p: PersistedGoals) => {
      saved.push(JSON.parse(JSON.stringify(p)));
    },
  };
}

function cfg(over: Partial<GoalConfig> & { id: string }): GoalConfig {
  return GoalConfigSchema.parse({ target: 100, ...over });
}

function ev(over: Partial<LiveEvent> & Pick<LiveEvent, "event">): LiveEvent {
  return { username: "@ana", nickname: "Ana", timestamp: 0, ...over };
}

function make(...configs: GoalConfig[]) {
  const store = memoryStore();
  const g = new GoalsEngine({ store });
  for (const c of configs) g.save(c);
  const get = (id: string): Goal => g.getGoals().find((x) => x.config.id === id)!;
  return { g, store, get };
}

describe("GoalsEngine — configuración", () => {
  it("crea una meta en 0 y la actualiza sin perder el avance", () => {
    const { g, get } = make(cfg({ id: "likes", metric: "likes" }));
    expect(get("likes").state).toEqual({ id: "likes", current: 0, target: 100, reached: 0 });
    g.handleLiveEvent(ev({ event: "like", likeCount: 30 }));
    g.save(cfg({ id: "likes", metric: "likes", title: "Likes" }));
    expect(get("likes").state.current).toBe(30);
    expect(get("likes").config.title).toBe("Likes");
  });

  it("cambiar el objetivo base actualiza el vigente", () => {
    const { g, get } = make(cfg({ id: "m" }));
    g.save(cfg({ id: "m", target: 500 }));
    expect(get("m").state.target).toBe(500);
  });

  it("borra una meta", () => {
    const { g } = make(cfg({ id: "m" }));
    g.remove("m");
    expect(g.getGoals()).toEqual([]);
  });

  it("carga lo guardado y emite state al cambiar", () => {
    const goal: Goal = { config: cfg({ id: "a" }), state: { id: "a", current: 7, target: 100, reached: 1 } };
    const g = new GoalsEngine({ store: memoryStore({ goals: [goal], seeded: true }) });
    expect(g.getGoals()[0].state.current).toBe(7);
    const fn = vi.fn();
    g.on("state", fn);
    g.control("a", "add", 1);
    expect(fn).toHaveBeenCalled();
  });
});

describe("GoalsEngine — metas por defecto", () => {
  it("la primera vez crea las metas por defecto, todas en 0, y lo guarda", async () => {
    const store = memoryStore();
    const g = new GoalsEngine({ store, presets: GOAL_PRESETS });
    expect(g.getGoals().map((x) => x.config.id)).toEqual(GOAL_PRESETS.map((x) => x.id));
    expect(g.getGoals().every((x) => x.state.current === 0 && x.state.target === x.config.target)).toBe(true);
    await vi.waitFor(() => expect(store.saved.at(-1)?.seeded).toBe(true));
  });

  it("si ya se sembraron, no reaparecen las que el usuario borró", () => {
    const g = new GoalsEngine({ store: memoryStore({ goals: [], seeded: true }), presets: GOAL_PRESETS });
    expect(g.getGoals()).toEqual([]);
  });

  it("sin presets (o con metas ya guardadas) no toca nada", () => {
    const own: Goal = { config: cfg({ id: "likes", target: 7 }), state: { id: "likes", current: 3, target: 7, reached: 0 } };
    const g = new GoalsEngine({ store: memoryStore({ goals: [own], seeded: false }), presets: GOAL_PRESETS });
    expect(g.getGoals().find((x) => x.config.id === "likes")?.state.current).toBe(3);
    expect(g.getGoals().filter((x) => x.config.id === "likes")).toHaveLength(1);
  });

  it("los presets traen likes, seguidores, compartidos, monedas, super fans y regalos; la rotativa es un id reservado", () => {
    expect(GOAL_PRESETS.map((x) => x.metric)).toEqual(["likes", "follows", "shares", "coins", "subscribes", "gifts"]);
    expect(GOAL_PRESETS.some((x) => x.id === GOAL_ROTATION_ID)).toBe(false);
  });
});

describe("GoalsEngine — métricas", () => {
  it("monedas: cuenta solo lo nuevo de un combo", () => {
    const { g, get } = make(cfg({ id: "c", metric: "coins" }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: false }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 30, repeatEnd: false }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 30, repeatEnd: true }));
    expect(get("c").state.current).toBe(30);
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 5, repeatEnd: true }));
    expect(get("c").state.current).toBe(35);
  });

  it("regalos: cuenta unidades (repeatCount acumulado) y respeta el filtro de regalo", () => {
    const { g, get } = make(cfg({ id: "r", metric: "gifts", giftId: 5655 }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 5655, coins: 1, repeatCount: 1, repeatEnd: false }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 5655, coins: 3, repeatCount: 3, repeatEnd: true }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 99, coins: 100, repeatCount: 1, repeatEnd: true }));
    expect(get("r").state.current).toBe(3);
  });

  it("likes usa likeCount; follows, shares, subscribes y comments suman 1", () => {
    const { g, get } = make(
      cfg({ id: "l", metric: "likes" }),
      cfg({ id: "f", metric: "follows" }),
      cfg({ id: "s", metric: "shares" }),
      cfg({ id: "u", metric: "subscribes" }),
      cfg({ id: "k", metric: "comments" }),
    );
    g.handleLiveEvent(ev({ event: "like", likeCount: 12 }));
    g.handleLiveEvent(ev({ event: "like" }));
    g.handleLiveEvent(ev({ event: "follow" }));
    g.handleLiveEvent(ev({ event: "share" }));
    g.handleLiveEvent(ev({ event: "subscribe" }));
    g.handleLiveEvent(ev({ event: "comment", text: "hola" }));
    expect([get("l"), get("f"), get("s"), get("u"), get("k")].map((x) => x.state.current)).toEqual([13, 1, 1, 1, 1]);
  });

  it("varias metas reciben el mismo evento a la vez", () => {
    const { g, get } = make(cfg({ id: "a", metric: "follows" }), cfg({ id: "b", metric: "follows" }));
    g.handleLiveEvent(ev({ event: "follow" }));
    expect(get("a").state.current).toBe(1);
    expect(get("b").state.current).toBe(1);
  });

  it("un regalo que no es de la métrica no suma", () => {
    const { g, get } = make(cfg({ id: "l", metric: "likes" }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 50, repeatEnd: true }));
    expect(get("l").state.current).toBe(0);
  });
});

describe("GoalsEngine — al cumplirse", () => {
  it("stay: queda lleno, cuenta el cruce una sola vez y emite goal-reached", () => {
    const { g, get } = make(cfg({ id: "m", metric: "follows", target: 2 }));
    const fn = vi.fn();
    g.on("goal-reached", fn);
    for (let i = 0; i < 4; i++) g.handleLiveEvent(ev({ event: "follow" }));
    expect(get("m").state).toMatchObject({ current: 4, target: 2, reached: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("grow: sube el objetivo en cada cruce, incluso varios de golpe", () => {
    const { g, get } = make(cfg({ id: "m", metric: "likes", target: 100, onReach: "grow", step: 50 }));
    g.handleLiveEvent(ev({ event: "like", likeCount: 100 }));
    expect(get("m").state).toMatchObject({ current: 100, target: 150, reached: 1 });
    g.handleLiveEvent(ev({ event: "like", likeCount: 120 }));
    expect(get("m").state).toMatchObject({ current: 220, target: 250, reached: 3 });
  });

  it("reset: vuelve a 0 conservando el sobrante", () => {
    const { g, get } = make(cfg({ id: "m", metric: "likes", target: 100, onReach: "reset" }));
    g.handleLiveEvent(ev({ event: "like", likeCount: 130 }));
    expect(get("m").state).toMatchObject({ current: 30, target: 100, reached: 1 });
  });

  it("restar por debajo del objetivo en stay permite volver a cumplir", () => {
    const { g, get } = make(cfg({ id: "m", metric: "follows", target: 2 }));
    g.control("m", "add", 2);
    g.control("m", "add", -1);
    g.control("m", "add", 1);
    expect(get("m").state.reached).toBe(2);
  });
});

describe("GoalsEngine — control manual y sesión", () => {
  it("add, set y reset", () => {
    const { g, get } = make(cfg({ id: "m", target: 100 }));
    g.control("m", "add", 10);
    expect(get("m").state.current).toBe(10);
    g.control("m", "set", 55);
    expect(get("m").state.current).toBe(55);
    g.control("m", "reset");
    expect(get("m").state).toMatchObject({ current: 0, target: 100, reached: 0 });
  });

  it("una meta inexistente devuelve false", () => {
    const { g } = make();
    expect(g.control("nada", "add", 1)).toBe(false);
  });

  it("resetSession olvida combos pero conserva el avance", () => {
    const { g, get } = make(cfg({ id: "c", metric: "coins" }));
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: false }));
    g.resetSession();
    g.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: true }));
    expect(get("c").state.current).toBe(20);
  });

  it("persiste tras cambios", async () => {
    const { g, store } = make(cfg({ id: "m", metric: "follows" }));
    g.handleLiveEvent(ev({ event: "follow" }));
    await vi.waitFor(() => expect(store.saved.at(-1)?.goals[0].state.current).toBe(1));
  });
});
