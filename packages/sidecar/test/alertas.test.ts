import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ALERT_PRESETS, alertText, isJoinGift, type AlertEvent, type LiveEvent } from "@streamtok/shared";
import { AlertasEngine, AlertasStore } from "../src/alertas.js";

const memoryStore = () => ({ load: () => ({ configs: [], seededIds: [], joinGiftNames: ["heart me", "quiéreme", "quiereme"] }), save: async () => {} });
const live = (e: Partial<LiveEvent>): LiveEvent => ({ event: "gift", username: "@ana", nickname: "Ana", timestamp: 1000, ...e });

function collect(engine: AlertasEngine): AlertEvent[] {
  const out: AlertEvent[] = [];
  engine.on("alert", (a: AlertEvent) => out.push(a));
  return out;
}

describe("AlertasEngine", () => {
  it("crea las alertas de fábrica una vez", () => {
    const engine = new AlertasEngine({ store: memoryStore(), presets: ALERT_PRESETS });
    expect(engine.getConfigs().map((c) => c.id)).toEqual(["comunidad", "donador", "todas"]);
  });

  it("una alerta de fábrica borrada no reaparece, pero sí una nueva", () => {
    const saved = { configs: [], seededIds: ["comunidad", "donador", "todas"], joinGiftNames: ["heart me"] };
    const engine = new AlertasEngine({ store: { load: () => saved, save: async () => {} }, presets: ALERT_PRESETS });
    expect(engine.getConfigs()).toEqual([]);
  });

  it("subida de nivel de fan y de donador → aviso con nombre, foto y niveles", () => {
    const engine = new AlertasEngine({ store: memoryStore() });
    const out = collect(engine);
    engine.handleLiveEvent(live({ event: "fanLevelUp", avatarUrl: "https://x/a.jpg", previousLevel: 3, newLevel: 4 }));
    engine.handleLiveEvent(live({ event: "donorLevelUp", nickname: undefined, previousLevel: 9, newLevel: 10 }));
    expect(out).toEqual([
      { kind: "fanLevelUp", name: "Ana", avatarUrl: "https://x/a.jpg", level: 4, previousLevel: 3, at: 1000 },
      { kind: "donorLevelUp", name: "ana", avatarUrl: undefined, level: 10, previousLevel: 9, at: 1000 },
    ]);
  });

  it("el regalo Heart Me avisa de que se unió; un combo no repite el aviso", () => {
    const engine = new AlertasEngine({ store: memoryStore() });
    const out = collect(engine);
    engine.handleLiveEvent(live({ giftName: "Heart Me", fanLevel: 1 }));
    engine.handleLiveEvent(live({ giftName: "Heart Me" }));
    engine.handleLiveEvent(live({ giftName: "Rose" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "fanJoin", name: "Ana", level: 1 });
  });

  it("al empezar otro LIVE vuelve a avisar", () => {
    const engine = new AlertasEngine({ store: memoryStore() });
    const out = collect(engine);
    engine.handleLiveEvent(live({ giftName: "Heart Me" }));
    engine.resetSession();
    engine.handleLiveEvent(live({ giftName: "Heart Me" }));
    expect(out).toHaveLength(2);
  });

  it("los nombres de regalo de unirse se pueden cambiar", () => {
    const engine = new AlertasEngine({ store: memoryStore() });
    const out = collect(engine);
    engine.setJoinGiftNames(["Corazón Fan"]);
    engine.handleLiveEvent(live({ giftName: "Heart Me" }));
    engine.handleLiveEvent(live({ giftName: "corazón fan" }));
    expect(out).toHaveLength(1);
    engine.setJoinGiftNames([]); // vacío = vuelve a los de fábrica
    expect(engine.getJoinGiftNames()).toContain("heart me");
  });

  it("test lanza un aviso de ejemplo del tipo pedido", () => {
    const engine = new AlertasEngine({ store: memoryStore() });
    const out = collect(engine);
    engine.test("donorLevelUp");
    expect(out[0]).toMatchObject({ kind: "donorLevelUp", level: 10 });
  });

  it("save añade o reemplaza una configuración y avisa del cambio", () => {
    const engine = new AlertasEngine({ store: memoryStore(), presets: ALERT_PRESETS });
    const onState = vi.fn();
    engine.on("state", onState);
    const cfg = { ...engine.getConfigs()[0], durationSec: 9 };
    engine.save(cfg);
    expect(engine.getConfigs()[0].durationSec).toBe(9);
    expect(engine.getConfigs()).toHaveLength(3);
    expect(onState).toHaveBeenCalledTimes(1);
  });
});

describe("AlertasStore", () => {
  it("guarda y vuelve a leer; un archivo corrupto se ignora", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alertas-"));
    const file = join(dir, "alertas.json");
    const warns: string[] = [];
    const store = new AlertasStore(file, (m) => warns.push(m));
    expect(store.load().configs).toEqual([]);
    await store.save({ configs: [ALERT_PRESETS[0]], seededIds: ["comunidad"], joinGiftNames: ["heart me"] });
    expect(store.load().configs[0].id).toBe("comunidad");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "{no es json", "utf8");
    expect(store.load().configs).toEqual([]);
    expect(warns.length).toBe(1);
    expect(await readFile(file, "utf8")).toBe("{no es json");
  });
});

describe("helpers de alertas", () => {
  it("alertText sustituye nombre y nivel", () => {
    expect(alertText("{nombre} llegó al nivel {nivel}", "Ana", 7)).toBe("Ana llegó al nivel 7");
    expect(alertText("{nombre} se unió", "Ana")).toBe("Ana se unió");
  });
  it("isJoinGift ignora mayúsculas y espacios", () => {
    expect(isJoinGift(" Heart Me ", ["heart me"])).toBe(true);
    expect(isJoinGift("Rose", ["heart me"])).toBe(false);
    expect(isJoinGift(undefined, ["heart me"])).toBe(false);
  });
});
