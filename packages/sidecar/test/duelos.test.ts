import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandMatches,
  DUEL_PRESETS,
  DuelConfigSchema,
  giftMatches,
  type DuelConfig,
  type LiveEvent,
} from "@streamtok/shared";
import { DuelosEngine, DuelosStore } from "../src/duelos.js";

const memoryStore = () => ({ load: () => ({ configs: [], seededIds: [], runtime: {} }), save: async () => {} });
const live = (e: Partial<LiveEvent>): LiveEvent => ({ event: "gift", username: "@ana", nickname: "Ana", timestamp: 1000, ...e });

const regalos = DuelConfigSchema.parse({
  id: "r",
  mode: "regalos",
  metric: "gifts",
  sides: [
    { name: "Rose", gifts: ["Rose", "5655"] },
    { name: "Dedo", gifts: ["Finger Heart"] },
  ],
});
const equipos = DuelConfigSchema.parse({
  id: "e",
  mode: "equipos",
  metric: "coins",
  sides: [
    { name: "AZUL", commands: ["!azul"] },
    { name: "ROJO", commands: ["!rojo"] },
  ],
});
const top = DuelConfigSchema.parse({ id: "t", mode: "top", metric: "coins", sides: [{}, {}] });

function engineWith(...configs: DuelConfig[]) {
  const engine = new DuelosEngine({ store: memoryStore() });
  for (const c of configs) engine.save(c);
  return engine;
}

describe("coincidencias", () => {
  it("regalo por nombre (sin mayúsculas) o por id", () => {
    expect(giftMatches(["Rose"], "rose", 1)).toBe(true);
    expect(giftMatches(["5655"], "Otro", 5655)).toBe(true);
    expect(giftMatches(["5655"], "Otro", 7)).toBe(false);
    expect(giftMatches([], "Rose")).toBe(false);
    expect(giftMatches(["Rose"], undefined, undefined)).toBe(false);
  });

  it("comando: solo la primera palabra, sin mayúsculas", () => {
    expect(commandMatches(["!azul"], "  !AZUL por favor")).toBe(true);
    expect(commandMatches(["!azul"], "!azulejo")).toBe(false);
    expect(commandMatches(["!azul"], "hola !azul")).toBe(false);
    expect(commandMatches(["!azul"], undefined)).toBe(false);
  });
});

describe("DuelosEngine · fábrica", () => {
  it("crea los duelos de fábrica una vez", () => {
    const engine = new DuelosEngine({ store: memoryStore(), presets: DUEL_PRESETS });
    expect(engine.getConfigs().map((c) => c.id)).toEqual(["regalo-vs-regalo", "equipos", "top"]);
  });

  it("un duelo de fábrica borrado no reaparece", () => {
    const saved = { configs: [], seededIds: DUEL_PRESETS.map((p) => p.id), runtime: {} };
    const engine = new DuelosEngine({ store: { load: () => saved, save: async () => {} }, presets: DUEL_PRESETS });
    expect(engine.getConfigs()).toEqual([]);
  });
});

describe("DuelosEngine · regalos", () => {
  it("cuenta cada lado con sus regalos y no cuenta los demás", () => {
    const engine = engineWith(regalos);
    engine.handleLiveEvent(live({ giftName: "Rose", giftId: 5655, repeatCount: 3, coins: 3, repeatEnd: true }));
    engine.handleLiveEvent(live({ giftName: "Finger Heart", giftId: 5487, coins: 5, repeatEnd: true }));
    engine.handleLiveEvent(live({ giftName: "GG", giftId: 1, coins: 1, repeatEnd: true }));
    const s = engine.getState("r")!;
    expect(s.sides[0].score).toBe(3);
    expect(s.sides[1].score).toBe(1);
  });

  it("por monedas cada regalo suma su valor; por cantidad, 1 cueste lo que cueste", () => {
    const porMonedas = { ...regalos, id: "m", metric: "coins" as const, sides: [{ ...regalos.sides[0], gifts: ["Gem Gun"] }, regalos.sides[1]] as DuelConfig["sides"] };
    const engine = engineWith(porMonedas, { ...porMonedas, id: "q", metric: "gifts" });
    engine.handleLiveEvent(live({ giftName: "Gem Gun", giftId: 99, coins: 500, repeatEnd: true }));
    expect(engine.getState("m")!.sides[0].score).toBe(500);
    expect(engine.getState("q")!.sides[0].score).toBe(1);
  });

  it("por monedas cada regalo suma su valor; por cantidad, 1 cueste lo que cueste", () => {
    const side0 = { ...regalos.sides[0], gifts: ["Gem Gun"] };
    const porMonedas: DuelConfig = { ...regalos, id: "m", metric: "coins", sides: [side0, regalos.sides[1]] };
    const engine = engineWith(porMonedas, { ...porMonedas, id: "q", metric: "gifts" });
    engine.handleLiveEvent(live({ giftName: "Gem Gun", giftId: 99, coins: 500, repeatEnd: true }));
    expect(engine.getState("m")!.sides[0].score).toBe(500);
    expect(engine.getState("q")!.sides[0].score).toBe(1);
  });

  it("un combo suma solo lo nuevo de cada mensaje", () => {
    const engine = engineWith(regalos);
    const g = { giftName: "Rose", giftId: 5655 };
    engine.handleLiveEvent(live({ ...g, repeatCount: 1, coins: 1, repeatEnd: false }));
    engine.handleLiveEvent(live({ ...g, repeatCount: 4, coins: 4, repeatEnd: false }));
    engine.handleLiveEvent(live({ ...g, repeatCount: 5, coins: 5, repeatEnd: true }));
    expect(engine.getState("r")!.sides[0].score).toBe(5);
    // un combo nuevo empieza de cero
    engine.handleLiveEvent(live({ ...g, repeatCount: 2, coins: 2, repeatEnd: true }));
    expect(engine.getState("r")!.sides[0].score).toBe(7);
  });

  it("con la métrica monedas suma las monedas", () => {
    const engine = engineWith({ ...regalos, metric: "coins" });
    engine.handleLiveEvent(live({ giftName: "Finger Heart", coins: 10, repeatCount: 2, repeatEnd: true }));
    expect(engine.getState("r")!.sides[1].score).toBe(10);
  });

  it("guarda quién aportó más a cada lado, con su foto", () => {
    const engine = engineWith(regalos);
    const rose = { giftName: "Rose", coins: 1, repeatEnd: true };
    engine.handleLiveEvent(live({ ...rose, repeatCount: 2, username: "@ana", nickname: "Ana", avatarUrl: "https://x/a.jpg" }));
    engine.handleLiveEvent(live({ ...rose, repeatCount: 5, username: "@bea", nickname: "Bea" }));
    engine.handleLiveEvent(live({ ...rose, repeatCount: 1, username: "@ana", nickname: "Ana" }));
    const sup = engine.getState("r")!.sides[0].supporters;
    expect(sup.map((s) => [s.name, s.score])).toEqual([["Bea", 5], ["Ana", 3]]);
    expect(sup[1].avatarUrl).toBe("https://x/a.jpg");
  });

  it("los likes y comentarios no cuentan en este modo", () => {
    const engine = engineWith(regalos);
    engine.handleLiveEvent(live({ event: "like", likeCount: 50 }));
    engine.handleLiveEvent(live({ event: "comment", text: "hola" }));
    expect(engine.getState("r")!.sides.map((x) => x.score)).toEqual([0, 0]);
  });
});

describe("DuelosEngine · equipos", () => {
  it("se unen con el comando; solo suma quien está en un equipo", () => {
    const engine = engineWith(equipos);
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 10, repeatEnd: true })); // sin equipo: no cuenta
    engine.handleLiveEvent(live({ event: "comment", text: "!azul" }));
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 10, repeatEnd: true }));
    engine.handleLiveEvent(live({ event: "comment", text: "!rojo", username: "@bea", nickname: "Bea" }));
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 4, repeatEnd: true, username: "@bea", nickname: "Bea" }));
    const s = engine.getState("e")!;
    expect(s.sides.map((x) => x.score)).toEqual([10, 4]);
    expect(s.sides.map((x) => x.members)).toEqual([1, 1]);
  });

  it("el primer equipo elegido se queda", () => {
    const engine = engineWith(equipos);
    engine.handleLiveEvent(live({ event: "comment", text: "!azul" }));
    engine.handleLiveEvent(live({ event: "comment", text: "!rojo" }));
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 7, repeatEnd: true }));
    expect(engine.getState("e")!.sides.map((x) => x.score)).toEqual([7, 0]);
  });

  it("métrica likes: suma los taps del equipo", () => {
    const engine = engineWith({ ...equipos, metric: "likes" });
    engine.handleLiveEvent(live({ event: "comment", text: "!rojo" }));
    engine.handleLiveEvent(live({ event: "like", likeCount: 12 }));
    engine.handleLiveEvent(live({ event: "like" }));
    expect(engine.getState("e")!.sides[1].score).toBe(13);
  });

  it("métrica comentarios: el comando de unirse no cuenta, los siguientes sí", () => {
    const engine = engineWith({ ...equipos, metric: "comments" });
    engine.handleLiveEvent(live({ event: "comment", text: "!azul" }));
    engine.handleLiveEvent(live({ event: "comment", text: "vamos azul" }));
    engine.handleLiveEvent(live({ event: "comment", text: "otro" }));
    expect(engine.getState("e")!.sides[0].score).toBe(2);
  });
});

describe("DuelosEngine · top 1 vs top 2", () => {
  it("los dos mayores donadores de la sesión, con foto, y se reordenan", () => {
    const engine = engineWith(top);
    const gift = (u: string, n: string, coins: number, avatarUrl?: string) =>
      engine.handleLiveEvent(live({ username: u, nickname: n, coins, avatarUrl, giftName: "Rose", repeatEnd: true }));
    gift("@ana", "Ana", 50, "https://x/a.jpg");
    gift("@bea", "Bea", 30);
    gift("@cai", "Cai", 20);
    let s = engine.getState("t")!;
    expect(s.sides.map((x) => [x.name, x.score])).toEqual([["Ana", 50], ["Bea", 30]]);
    expect(s.sides[0].avatarUrl).toBe("https://x/a.jpg");
    gift("@cai", "Cai", 40); // Cai pasa a 60
    s = engine.getState("t")!;
    expect(s.sides.map((x) => x.name)).toEqual(["Cai", "Ana"]);
  });

  it("con menos de dos donadores deja el puesto vacío", () => {
    const engine = engineWith(top);
    expect(engine.getState("t")!.sides.map((x) => [x.name, x.score])).toEqual([[undefined, 0], [undefined, 0]]);
    engine.handleLiveEvent(live({ coins: 9, giftName: "Rose", repeatEnd: true }));
    expect(engine.getState("t")!.sides.map((x) => [x.name, x.score])).toEqual([["Ana", 9], [undefined, 0]]);
  });
});

describe("DuelosEngine · gestión", () => {
  it("reset deja el marcador y los equipos en cero", () => {
    const engine = engineWith(equipos);
    engine.handleLiveEvent(live({ event: "comment", text: "!azul" }));
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 7, repeatEnd: true }));
    engine.reset("e");
    const s = engine.getState("e")!;
    expect(s.sides.map((x) => [x.score, x.members])).toEqual([[0, 0], [0, 0]]);
    // ya no está en ningún equipo
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 7, repeatEnd: true }));
    expect(engine.getState("e")!.sides[0].score).toBe(0);
  });

  it("adjust suma o resta a mano y no baja de cero", () => {
    const engine = engineWith(regalos);
    engine.adjust("r", 0, 10);
    engine.adjust("r", 1, 3);
    engine.adjust("r", 1, -50);
    expect(engine.getState("r")!.sides.map((x) => x.score)).toEqual([10, 0]);
  });

  it("emite `state` cuando cambia algo", () => {
    const engine = engineWith(regalos);
    let n = 0;
    engine.on("state", () => n++);
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 1, repeatEnd: true }));
    engine.handleLiveEvent(live({ giftName: "Nada", coins: 1, repeatEnd: true }));
    engine.adjust("r", 0, 1);
    engine.reset("r");
    expect(n).toBe(3);
  });

  it("guardar un duelo lo crea o lo reemplaza; un id desconocido no tiene estado", () => {
    const engine = engineWith(regalos);
    engine.save({ ...regalos, title: "Nuevo" });
    expect(engine.getConfigs()).toHaveLength(1);
    expect(engine.getConfigs()[0].title).toBe("Nuevo");
    expect(engine.getState("zzz")).toBeUndefined();
  });
});

describe("DuelosEngine · nueva sesión", () => {
  it("al conectar a otro LIVE, el top empieza de cero y los demás marcadores se conservan", () => {
    const engine = engineWith(top, regalos);
    engine.handleLiveEvent(live({ giftName: "Rose", coins: 9, repeatEnd: true }));
    engine.resetSession();
    expect(engine.getState("t")!.sides[0].score).toBe(0);
    expect(engine.getState("r")!.sides[0].score).toBe(1);
  });
});

describe("DuelosStore", () => {
  it("guarda y vuelve a leer el marcador, las configuraciones y los equipos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duelos-"));
    const file = join(dir, "duelos.json");
    const store = new DuelosStore(file);
    const a = new DuelosEngine({ store });
    a.save(equipos);
    a.handleLiveEvent(live({ event: "comment", text: "!azul" }));
    a.handleLiveEvent(live({ giftName: "Rose", coins: 8, repeatEnd: true }));
    await a.flush();
    expect(JSON.parse(await readFile(file, "utf8")).configs[0].id).toBe("e");

    const b = new DuelosEngine({ store: new DuelosStore(file) });
    expect(b.getState("e")!.sides[0].score).toBe(8);
    b.handleLiveEvent(live({ giftName: "Rose", coins: 2, repeatEnd: true })); // sigue en el equipo azul
    expect(b.getState("e")!.sides[0].score).toBe(10);
  });

  it("un archivo corrupto se ignora", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duelos-"));
    const file = join(dir, "duelos.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(file, "{no es json"));
    const warns: string[] = [];
    expect(new DuelosStore(file, (m) => warns.push(m)).load().configs).toEqual([]);
    expect(warns).toHaveLength(1);
  });
});
