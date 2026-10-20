import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dayKey, TOP_PRESETS, TopConfigSchema, type LiveEvent, type TopConfig } from "@streamtok/shared";
import { TopsEngine, TopsStore } from "../src/tops.js";

const memoryStore = () => ({ load: () => ({ configs: [], seededIds: [], runtime: {} }), save: async () => {} });
const live = (e: Partial<LiveEvent>): LiveEvent => ({ event: "gift", username: "@ana", nickname: "Ana", timestamp: 1000, ...e });

const coins = TopConfigSchema.parse({ id: "g", metric: "coins", count: 2 });
const likes = TopConfigSchema.parse({ id: "l", metric: "likes" });
const comments = TopConfigSchema.parse({ id: "c", metric: "comments" });
const shares = TopConfigSchema.parse({ id: "s", metric: "shares" });

function engineWith(configs: TopConfig[], now?: () => Date) {
  const engine = new TopsEngine({ store: memoryStore(), now });
  for (const c of configs) engine.save(c);
  return engine;
}

describe("TopsEngine", () => {
  it("de fábrica trae Gifters, Gifters del día, Likes, Comentarios, Compartidos y Trivia", () => {
    const engine = new TopsEngine({ store: memoryStore(), presets: TOP_PRESETS });
    expect(engine.getConfigs().map((c) => c.id)).toEqual(["gifters", "gifters-dia", "likes", "comentarios", "compartidos", "trivia"]);
  });

  it("suma monedas por persona y ordena de mayor a menor, con el tope de puestos", () => {
    const engine = engineWith([coins]);
    engine.handleLiveEvent(live({ coins: 5 }));
    engine.handleLiveEvent(live({ username: "@bruno", nickname: "Bruno", coins: 30, avatarUrl: "https://x/b.png" }));
    engine.handleLiveEvent(live({ username: "@cami", nickname: "Cami", coins: 1 }));
    engine.handleLiveEvent(live({ coins: 10 }));
    const s = engine.getState("g")!;
    expect(s.entries.map((e) => [e.name, e.score])).toEqual([
      ["Bruno", 30],
      ["Ana", 15],
    ]); // count = 2
    expect(s.entries[0].avatarUrl).toBe("https://x/b.png");
  });

  it("en un combo cuenta solo lo nuevo de cada mensaje", () => {
    const engine = engineWith([coins]);
    engine.handleLiveEvent(live({ coins: 5, repeatEnd: false }));
    engine.handleLiveEvent(live({ coins: 15, repeatEnd: false }));
    engine.handleLiveEvent(live({ coins: 20, repeatEnd: true }));
    expect(engine.getState("g")!.entries[0].score).toBe(20);
  });

  it("cada ranking cuenta solo lo suyo: likes, comentarios y compartidos", () => {
    const engine = engineWith([coins, likes, comments, shares]);
    engine.handleLiveEvent(live({ event: "like", likeCount: 7 }));
    engine.handleLiveEvent(live({ event: "like" }));
    engine.handleLiveEvent(live({ event: "comment", text: "hola" }));
    engine.handleLiveEvent(live({ event: "comment", text: "hola otra vez" }));
    engine.handleLiveEvent(live({ event: "share" }));
    expect(engine.getState("l")!.entries[0].score).toBe(8);
    expect(engine.getState("c")!.entries[0].score).toBe(2);
    expect(engine.getState("s")!.entries[0].score).toBe(1);
    expect(engine.getState("g")!.entries).toEqual([]);
  });

  it("el nombre de usuario sin @ y en minúsculas es la misma persona", () => {
    const engine = engineWith([likes]);
    engine.handleLiveEvent(live({ event: "like", username: "@Ana", nickname: "Ana" }));
    engine.handleLiveEvent(live({ event: "like", username: "ana", nickname: "Ana M." }));
    const s = engine.getState("l")!;
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ name: "Ana M.", score: 2 });
  });

  it("test suma a una persona de prueba solo en ese top; reset lo deja en cero", () => {
    const engine = engineWith([coins, likes]);
    engine.test("g", "Luna", 40);
    engine.test("g", "Luna", 2);
    expect(engine.getState("g")!.entries[0]).toMatchObject({ name: "Luna", score: 42 });
    expect(engine.getState("l")!.entries).toEqual([]);
    engine.reset("g");
    expect(engine.getState("g")!.entries).toEqual([]);
    engine.test("zzz", "Luna", 1); // top inexistente: no hace nada
    engine.test("g", "Luna", 0);
    expect(engine.getState("g")!.entries).toEqual([]);
  });

  it("cambiar qué se cuenta vacía el ranking; cambiar solo el título no", () => {
    const engine = engineWith([coins]);
    engine.test("g", "Luna", 40);
    engine.save({ ...coins, title: "Mis donadores" });
    expect(engine.getState("g")!.entries).toHaveLength(1);
    engine.save({ ...coins, title: "Mis donadores", metric: "likes" });
    expect(engine.getState("g")!.entries).toEqual([]);
  });

  it("resetSession vacía los de la sesión y respeta los del día", () => {
    const daily = TopConfigSchema.parse({ id: "d", metric: "coins", period: "day" });
    const engine = engineWith([coins, daily]);
    engine.handleLiveEvent(live({ coins: 5 }));
    engine.resetSession();
    expect(engine.getState("g")!.entries).toEqual([]);
    expect(engine.getState("d")!.entries).toHaveLength(1);
  });

  it("el ranking del día se vacía al cambiar de día", () => {
    let now = new Date(2026, 9, 19, 23, 50);
    const daily = TopConfigSchema.parse({ id: "d", metric: "coins", period: "day" });
    const engine = engineWith([daily], () => now);
    engine.handleLiveEvent(live({ coins: 5 }));
    expect(engine.getState("d")!.entries).toHaveLength(1);
    now = new Date(2026, 9, 20, 0, 5);
    let changes = 0;
    engine.on("state", () => changes++);
    engine.checkDay();
    expect(changes).toBe(1);
    expect(engine.getState("d")!.entries).toEqual([]);
    engine.checkDay(); // sin cambio de día: no avisa
    expect(changes).toBe(1);
  });

  it("persiste la configuración y el ranking, y los recupera", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tops-"));
    const file = join(dir, "tops.json");
    const a = new TopsEngine({ store: new TopsStore(file), presets: TOP_PRESETS });
    a.handleLiveEvent(live({ coins: 9 }));
    await a.flush();
    expect(JSON.parse(await readFile(file, "utf8")).runtime.gifters.people[0].score).toBe(9);
    const b = new TopsEngine({ store: new TopsStore(file), presets: TOP_PRESETS });
    expect(b.getConfigs()).toHaveLength(6);
    expect(b.getState("gifters")!.entries[0]).toMatchObject({ name: "Ana", score: 9 });
  });

  it("un archivo corrupto se ignora y avisa", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tops-"));
    const file = join(dir, "tops.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{ no es json", "utf8");
    const warns: string[] = [];
    const engine = new TopsEngine({ store: new TopsStore(file, (m) => warns.push(m)), presets: TOP_PRESETS });
    expect(engine.getConfigs()).toHaveLength(6);
    expect(warns).toHaveLength(1);
  });

  it("dayKey da el día local como YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
