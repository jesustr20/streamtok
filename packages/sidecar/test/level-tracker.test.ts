import { describe, expect, it } from "vitest";
import { LevelTracker } from "../src/level-tracker.js";

describe("LevelTracker", () => {
  it("la primera vez que ve a un usuario no emite subida (no hay nivel anterior)", () => {
    const t = new LevelTracker();
    expect(t.observe("@ana", { userLevel: 20, fanLevel: 10 })).toEqual([]);
  });

  it("emite donorLevelUp cuando el nivel de donador aumenta", () => {
    const t = new LevelTracker();
    t.observe("ana", { userLevel: 6 });
    expect(t.observe("ana", { userLevel: 7 })).toEqual([
      { kind: "donorLevelUp", previousLevel: 6, newLevel: 7 },
    ]);
  });

  it("emite fanLevelUp cuando el nivel de fan aumenta", () => {
    const t = new LevelTracker();
    t.observe("ana", { fanLevel: 1 });
    expect(t.observe("ana", { fanLevel: 2 })).toEqual([{ kind: "fanLevelUp", previousLevel: 1, newLevel: 2 }]);
  });

  it("puede emitir las dos subidas a la vez", () => {
    const t = new LevelTracker();
    t.observe("ana", { userLevel: 5, fanLevel: 1 });
    const out = t.observe("ana", { userLevel: 6, fanLevel: 2 });
    expect(out.map((c) => c.kind).sort()).toEqual(["donorLevelUp", "fanLevelUp"]);
  });

  it("mismo nivel no emite; una bajada solo actualiza el nivel recordado", () => {
    const t = new LevelTracker();
    t.observe("ana", { userLevel: 6 });
    expect(t.observe("ana", { userLevel: 6 })).toEqual([]);
    expect(t.observe("ana", { userLevel: 4 })).toEqual([]);
    expect(t.observe("ana", { userLevel: 5 })).toEqual([{ kind: "donorLevelUp", previousLevel: 4, newLevel: 5 }]);
  });

  it("un mensaje sin nivel no borra lo recordado (ej. un Like sin insignias)", () => {
    const t = new LevelTracker();
    t.observe("ana", { userLevel: 6 });
    expect(t.observe("ana", {})).toEqual([]);
    expect(t.observe("ana", { userLevel: 7 })).toEqual([{ kind: "donorLevelUp", previousLevel: 6, newLevel: 7 }]);
  });

  it("separa usuarios y no distingue @ ni mayúsculas", () => {
    const t = new LevelTracker();
    t.observe("@Ana", { userLevel: 6 });
    t.observe("bob", { userLevel: 10 });
    expect(t.observe("ana", { userLevel: 7 })).toHaveLength(1);
    expect(t.observe("bob", { userLevel: 10 })).toEqual([]);
  });

  it("reset() olvida a todos (nueva sesión)", () => {
    const t = new LevelTracker();
    t.observe("ana", { userLevel: 6 });
    t.reset();
    expect(t.observe("ana", { userLevel: 7 })).toEqual([]);
  });
});
