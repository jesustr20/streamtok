import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlaysConfigSchema, type LiveEvent, type OverlaysConfig } from "@streamtok/shared";
import { OverlayCounters, type PersistedOverlays } from "../src/overlay-counters.js";

/** Store en memoria: guarda lo último que se le pidió persistir. */
function memoryStore(initial?: PersistedOverlays) {
  const saved: PersistedOverlays[] = [];
  return {
    saved,
    load: () => initial ?? { config: OverlaysConfigSchema.parse({}) },
    save: async (p: PersistedOverlays) => {
      saved.push(JSON.parse(JSON.stringify(p)));
    },
  };
}

function cfg(over: Partial<OverlaysConfig["timer"]> = {}, perType: Partial<OverlaysConfig["timer"]["perType"]> = {}): OverlaysConfig {
  const base = OverlaysConfigSchema.parse({});
  return { ...base, timer: { ...base.timer, ...over, perType: { ...base.timer.perType, ...perType } } };
}

function ev(over: Partial<LiveEvent> & Pick<LiveEvent, "event">): LiveEvent {
  return { username: "@ana", nickname: "Ana", timestamp: Date.now(), ...over };
}

const T0 = new Date("2026-10-14T12:00:00Z").getTime();

describe("OverlayCounters — timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  function make(config?: OverlaysConfig) {
    const store = memoryStore(config ? { config } : undefined);
    const c = new OverlayCounters({ store });
    return { c, store };
  }

  it("arranca en idle con el valor inicial por defecto (60 s)", () => {
    const { c } = make();
    const s = c.getState();
    expect(s.timer.status).toBe("idle");
    expect(s.timer.remainingMs).toBe(60_000);
    expect(s.wins).toEqual({ title: "Win Game", goal: 10, count: 0 });
  });

  it("start: corre, guarda la hora de fin y los segundos bajan con el reloj", () => {
    const { c } = make();
    c.timerStart();
    const s = c.getState();
    expect(s.timer.status).toBe("running");
    expect(s.timer.endsAt).toBe(T0 + 60_000);
    vi.advanceTimersByTime(20_000);
    expect(c.getState().timer.remainingMs).toBe(40_000);
  });

  it("al llegar a 0 termina, queda en 0 y avisa una sola vez con las acciones de 'al expirar'", () => {
    const { c } = make(cfg({ startSeconds: 10, onExpireAccionIds: ["a1", "a2"] }));
    const expired = vi.fn();
    c.on("timer-expired", expired);
    c.timerStart();
    vi.advanceTimersByTime(9_999);
    expect(expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(c.getState().timer).toMatchObject({ status: "finished", remainingMs: 0 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith(["a1", "a2"]);
    vi.advanceTimersByTime(60_000);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("pause conserva el tiempo restante y start lo reanuda", () => {
    const { c } = make(cfg({ startSeconds: 30 }));
    c.timerStart();
    vi.advanceTimersByTime(10_000);
    c.timerPause();
    expect(c.getState().timer).toMatchObject({ status: "paused", remainingMs: 20_000 });
    vi.advanceTimersByTime(100_000);
    expect(c.getState().timer.remainingMs).toBe(20_000);
    c.timerStart();
    expect(c.getState().timer.status).toBe("running");
    vi.advanceTimersByTime(5_000);
    expect(c.getState().timer.remainingMs).toBe(15_000);
  });

  it("reset vuelve al valor inicial detenido; stop deja 0", () => {
    const { c } = make(cfg({ startSeconds: 45 }));
    c.timerStart();
    vi.advanceTimersByTime(5_000);
    c.timerReset();
    expect(c.getState().timer).toMatchObject({ status: "idle", remainingMs: 45_000 });
    c.timerStart();
    c.timerStop();
    expect(c.getState().timer).toMatchObject({ status: "idle", remainingMs: 0 });
  });

  it("start desde idle con 0 usa el valor inicial; desde idle con un valor fijado usa ese", () => {
    const { c } = make(cfg({ startSeconds: 45 }));
    c.timerStop();
    c.timerStart();
    expect(c.getState().timer.endsAt).toBe(T0 + 45_000);
    c.timerStop();
    c.timerSet(20);
    c.timerStart();
    expect(c.getState().timer.endsAt).toBe(T0 + 20_000);
  });

  it("add corriendo extiende (y reprograma el fin); restar más de lo que queda termina", () => {
    const { c } = make(cfg({ startSeconds: 10 }));
    const expired = vi.fn();
    c.on("timer-expired", expired);
    c.timerStart();
    c.timerAdd(10);
    vi.advanceTimersByTime(10_000);
    expect(c.getState().timer.status).toBe("running");
    expect(expired).not.toHaveBeenCalled();
    c.timerAdd(-60);
    expect(c.getState().timer).toMatchObject({ status: "finished", remainingMs: 0 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("add automático (eventos) no hace nada si el timer no corre; el manual (botones) sí", () => {
    const { c } = make(cfg({ startSeconds: 30 }));
    c.timerAdd(10);
    expect(c.getState().timer.remainingMs).toBe(30_000);
    c.timerAdd(10, { manual: true });
    expect(c.getState().timer.remainingMs).toBe(40_000);
    c.timerPause();
    c.timerAdd(-5, { manual: true });
    expect(c.getState().timer.remainingMs).toBe(35_000);
  });

  it("el tiempo máximo recorta lo que se sume", () => {
    const { c } = make(cfg({ startSeconds: 50, maxSeconds: 60 }));
    c.timerStart();
    c.timerAdd(30);
    expect(c.getState().timer.remainingMs).toBe(60_000);
  });

  it("set fija el tiempo restante (también corriendo)", () => {
    const { c } = make(cfg({ startSeconds: 50 }));
    c.timerStart();
    c.timerSet(5);
    expect(c.getState().timer.endsAt).toBe(T0 + 5_000);
    vi.advanceTimersByTime(5_000);
    expect(c.getState().timer.status).toBe("finished");
  });

  it("emite 'state' en cada cambio con serverNow", () => {
    const { c } = make();
    const seen: number[] = [];
    c.on("state", (s) => seen.push(s.serverNow));
    c.timerStart();
    c.timerPause();
    expect(seen).toEqual([T0, T0]);
  });
});

describe("OverlayCounters — segundos por tipo de interacción", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  function running(perType: Partial<OverlaysConfig["timer"]["perType"]>, extra: Partial<OverlaysConfig["timer"]> = {}) {
    const c = new OverlayCounters({ store: memoryStore({ config: cfg({ startSeconds: 100, ...extra }, perType) }) });
    c.timerStart();
    return c;
  }
  const remaining = (c: OverlayCounters) => c.getState().timer.remainingMs / 1000;

  it("suma por cada tipo: follow, share, suscripción, chat", () => {
    const c = running({ follow: 5, share: 3, subscribe: 30, chat: 1 });
    c.handleLiveEvent(ev({ event: "follow" }));
    c.handleLiveEvent(ev({ event: "share" }));
    c.handleLiveEvent(ev({ event: "subscribe" }));
    c.handleLiveEvent(ev({ event: "comment", text: "hola" }));
    expect(remaining(c)).toBe(100 + 5 + 3 + 30 + 1);
  });

  it("acepta negativos y decimales; los likes cuentan por tap", () => {
    const c = running({ like: 0.05 });
    c.handleLiveEvent(ev({ event: "like", likeCount: 40 }));
    c.handleLiveEvent(ev({ event: "like" }));
    expect(remaining(c)).toBeCloseTo(100 + 41 * 0.05, 5);
    const d = running({ follow: -10 });
    d.handleLiveEvent(ev({ event: "follow" }));
    expect(remaining(d)).toBe(90);
  });

  it("por moneda: regalo suelto suma coins × segundos", () => {
    const c = running({ coin: 3 });
    c.handleLiveEvent(ev({ event: "gift", giftId: 5655, coins: 10, repeatEnd: true }));
    expect(remaining(c)).toBe(130);
  });

  it("por moneda con combo: suma solo el incremento de cada mensaje, sin duplicar al cierre", () => {
    const c = running({ coin: 1 });
    const g = { event: "gift" as const, giftId: 5655 };
    c.handleLiveEvent(ev({ ...g, coins: 10, repeatEnd: false }));
    expect(remaining(c)).toBe(110);
    c.handleLiveEvent(ev({ ...g, coins: 30, repeatEnd: false }));
    expect(remaining(c)).toBe(130);
    c.handleLiveEvent(ev({ ...g, coins: 50, repeatEnd: true }));
    expect(remaining(c)).toBe(150);
    // un combo nuevo del mismo usuario y regalo empieza de cero
    c.handleLiveEvent(ev({ ...g, coins: 5, repeatEnd: true }));
    expect(remaining(c)).toBe(155);
  });

  it("los combos de usuarios distintos no se mezclan", () => {
    const c = running({ coin: 1 });
    c.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: false, username: "@a" }));
    c.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: false, username: "@b" }));
    expect(remaining(c)).toBe(120);
  });

  it("el multiplicador activo multiplica todo", () => {
    const c = running({ follow: 10, coin: 2 }, { multiplier: { active: true, value: 1.5 } });
    c.handleLiveEvent(ev({ event: "follow" }));
    c.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: true }));
    expect(remaining(c)).toBe(100 + 15 + 30);
  });

  it("no suma si el timer no está corriendo", () => {
    const c = new OverlayCounters({ store: memoryStore({ config: cfg({ startSeconds: 100 }, { follow: 5 }) }) });
    c.handleLiveEvent(ev({ event: "follow" }));
    expect(remaining(c)).toBe(100);
  });

  it("tipos con 0 segundos y eventos sin tipo de timer no hacen nada ni emiten estado", () => {
    const c = running({});
    const seen = vi.fn();
    c.on("state", seen);
    c.handleLiveEvent(ev({ event: "follow" }));
    c.handleLiveEvent(ev({ event: "join" }));
    expect(seen).not.toHaveBeenCalled();
  });

  it("resetSession olvida los combos en curso", () => {
    const c = running({ coin: 1 });
    c.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 10, repeatEnd: false }));
    c.resetSession();
    c.handleLiveEvent(ev({ event: "gift", giftId: 1, coins: 15, repeatEnd: false }));
    expect(remaining(c)).toBe(100 + 10 + 15);
  });
});

describe("OverlayCounters — wins", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());
  const make = () => new OverlayCounters({ store: memoryStore() });

  it("sumar, restar (sin bajar de 0), fijar y reiniciar el conteo", () => {
    const c = make();
    c.winsAdd(1);
    c.winsAdd(2);
    expect(c.getState().wins.count).toBe(3);
    c.winsAdd(-10);
    expect(c.getState().wins.count).toBe(0);
    c.winsSet(4);
    expect(c.getState().wins.count).toBe(4);
    c.winsReset();
    expect(c.getState().wins.count).toBe(0);
  });

  it("meta y título; la meta es entera y no negativa", () => {
    const c = make();
    c.winsSetGoal(6);
    c.winsSetTitle("Monte Chiliad");
    expect(c.getState().wins).toEqual({ title: "Monte Chiliad", goal: 6, count: 0 });
    c.winsSetGoal(-3);
    expect(c.getState().wins.goal).toBe(0);
    c.winsSetGoal(2.7);
    expect(c.getState().wins.goal).toBe(2);
  });

  it("avisa 'wins-goal' al alcanzar la meta, una vez por cruce", () => {
    const c = make();
    const reached = vi.fn();
    c.on("wins-goal", reached);
    c.winsSetGoal(2);
    c.winsAdd(1);
    expect(reached).not.toHaveBeenCalled();
    c.winsAdd(1);
    expect(reached).toHaveBeenCalledTimes(1);
    c.winsAdd(1); // ya la pasó: no avisa de nuevo
    expect(reached).toHaveBeenCalledTimes(1);
    c.winsSet(0);
    c.winsAdd(2);
    expect(reached).toHaveBeenCalledTimes(2);
  });

  it("con meta 0 nunca avisa", () => {
    const c = make();
    const reached = vi.fn();
    c.on("wins-goal", reached);
    c.winsSetGoal(0);
    c.winsAdd(5);
    expect(reached).not.toHaveBeenCalled();
  });
});

describe("OverlayCounters — comandos internos (app.*)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());
  const make = () => new OverlayCounters({ store: memoryStore({ config: cfg({ startSeconds: 100 }) }) });

  it("app.timer.start / add / pause / set / reset / stop", () => {
    const c = make();
    expect(c.applyAppCommand("app.timer.start", {})).toEqual({ ok: true });
    expect(c.applyAppCommand("app.timer.add", { seconds: -30 })).toEqual({ ok: true });
    expect(c.getState().timer.remainingMs).toBe(70_000);
    expect(c.applyAppCommand("app.timer.pause", {}).ok).toBe(true);
    expect(c.getState().timer.status).toBe("paused");
    expect(c.applyAppCommand("app.timer.set", { seconds: 12 }).ok).toBe(true);
    expect(c.getState().timer.remainingMs).toBe(12_000);
    expect(c.applyAppCommand("app.timer.reset", {}).ok).toBe(true);
    expect(c.getState().timer.remainingMs).toBe(100_000);
    expect(c.applyAppCommand("app.timer.stop", {}).ok).toBe(true);
    expect(c.getState().timer.remainingMs).toBe(0);
  });

  it("app.timer.add desde un Evento no cuenta si el timer no corre", () => {
    const c = make();
    c.applyAppCommand("app.timer.add", { seconds: 50 });
    expect(c.getState().timer.remainingMs).toBe(100_000);
  });

  it("app.wins.add / set / reset", () => {
    const c = make();
    expect(c.applyAppCommand("app.wins.add", { amount: 3 }).ok).toBe(true);
    expect(c.applyAppCommand("app.wins.set", { count: 7 }).ok).toBe(true);
    expect(c.getState().wins.count).toBe(7);
    expect(c.applyAppCommand("app.wins.reset", {}).ok).toBe(true);
    expect(c.getState().wins.count).toBe(0);
  });

  it("rechaza comandos desconocidos o con parámetros inválidos", () => {
    const c = make();
    expect(c.applyAppCommand("app.nada", {})).toMatchObject({ ok: false });
    expect(c.applyAppCommand("app.timer.add", { seconds: "diez" })).toMatchObject({ ok: false });
    expect(c.applyAppCommand("app.wins.add", {})).toMatchObject({ ok: false });
  });
});

describe("OverlayCounters — persistencia", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("guarda tras cada cambio", async () => {
    const store = memoryStore();
    const c = new OverlayCounters({ store });
    c.winsAdd(2);
    c.timerStart();
    await vi.advanceTimersByTimeAsync(0);
    const last = store.saved[store.saved.length - 1];
    expect(last.wins?.count).toBe(2);
    expect(last.timer?.status).toBe("running");
    expect(last.savedAt).toBe(T0);
  });

  it("al volver con el timer corriendo y 'recordar' activo, queda EN PAUSA con lo que faltaba al guardar", () => {
    const store = memoryStore({
      config: cfg({ startSeconds: 100, rememberOnClose: true }),
      timer: { status: "running", remainingMs: 0, endsAt: T0 + 40_000 },
      wins: { title: "W", goal: 3, count: 2 },
      savedAt: T0,
    });
    vi.setSystemTime(T0 + 3_600_000); // pasó una hora con la app cerrada
    const c = new OverlayCounters({ store });
    expect(c.getState().timer).toMatchObject({ status: "paused", remainingMs: 40_000 });
    expect(c.getState().wins).toEqual({ title: "W", goal: 3, count: 2 });
  });

  it("sin 'recordar', el timer vuelve al valor inicial; los wins se conservan", () => {
    const store = memoryStore({
      config: cfg({ startSeconds: 100, rememberOnClose: false }),
      timer: { status: "running", remainingMs: 0, endsAt: T0 + 40_000 },
      wins: { title: "W", goal: 3, count: 2 },
      savedAt: T0,
    });
    const c = new OverlayCounters({ store });
    expect(c.getState().timer).toMatchObject({ status: "idle", remainingMs: 100_000 });
    expect(c.getState().wins.count).toBe(2);
  });

  it("un timer en pausa o detenido se restaura tal cual", () => {
    const store = memoryStore({
      config: cfg({ startSeconds: 100 }),
      timer: { status: "paused", remainingMs: 12_000 },
    });
    const c = new OverlayCounters({ store });
    expect(c.getState().timer).toMatchObject({ status: "paused", remainingMs: 12_000 });
  });

  it("setConfig guarda; con el timer sin usar, adopta el nuevo valor inicial", async () => {
    const store = memoryStore();
    const c = new OverlayCounters({ store });
    c.setConfig(cfg({ startSeconds: 90 }));
    expect(c.getState().timer.remainingMs).toBe(90_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saved[store.saved.length - 1].config.timer.startSeconds).toBe(90);
  });

  it("setConfig no pisa un timer que ya está corriendo", () => {
    const c = new OverlayCounters({ store: memoryStore() });
    c.timerStart();
    c.setConfig(cfg({ startSeconds: 90 }));
    expect(c.getState().timer.status).toBe("running");
    expect(c.getState().timer.endsAt).toBe(T0 + 60_000);
  });
});
