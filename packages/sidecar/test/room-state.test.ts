import { describe, expect, it, vi } from "vitest";
import { RoomStateEngine, extractAvatarUrl, parseBattleArmies, parseBattleHosts, parseViewerCount } from "../src/room-state.js";

describe("parseViewerCount", () => {
  it("lee viewerCount (v1) y totalUser / total (v3, como texto)", () => {
    expect(parseViewerCount({ viewerCount: 42 })).toBe(42);
    expect(parseViewerCount({ totalUser: "1234" })).toBe(1234);
    expect(parseViewerCount({ total: "7" })).toBe(7);
  });
  it("ignora lo que no es un número válido", () => {
    expect(parseViewerCount({})).toBeNull();
    expect(parseViewerCount({ viewerCount: -3 })).toBeNull();
    expect(parseViewerCount({ viewerCount: "abc" })).toBeNull();
    expect(parseViewerCount(null)).toBeNull();
  });
});

describe("extractAvatarUrl", () => {
  it("toma la primera URL de la miniatura, y si falta, de la mediana o la grande", () => {
    expect(extractAvatarUrl({ avatarThumb: { urlList: ["https://x/a.jpg", "https://x/b.jpg"] } })).toBe("https://x/a.jpg");
    expect(extractAvatarUrl({ avatarThumb: { urlList: [] }, avatarMedium: { urlList: ["https://x/m.jpg"] } })).toBe("https://x/m.jpg");
    expect(extractAvatarUrl({ avatarLarge: { url_list: ["https://x/l.jpg"] } })).toBe("https://x/l.jpg");
    expect(extractAvatarUrl({ profilePicture: { urls: ["https://x/p.jpg"] } })).toBe("https://x/p.jpg");
  });
  it("sin imagen, undefined", () => {
    expect(extractAvatarUrl({})).toBeUndefined();
    expect(extractAvatarUrl(undefined)).toBeUndefined();
  });
});

describe("parseBattleArmies", () => {
  const v3 = {
    battleId: "b1",
    armies: {
      "111": {
        hostscore: "345",
        anchorIdStr: "111",
        userArmies: [
          { nickname: "Ana", score: "100", avatarThumb: { urlList: ["https://x/ana.jpg"] } },
          { nickname: "Beto", score: "250" },
        ],
      },
      "222": { hostscore: "103", anchorIdStr: "222", userArmies: [] },
    },
  };

  it("lee el formato v3: puntos por lado y apoyadores ordenados de mayor a menor", () => {
    const b = parseBattleArmies(v3, 1000)!;
    expect(b.battleId).toBe("b1");
    expect(b.updatedAt).toBe(1000);
    expect(b.sides.map((s) => [s.id, s.points])).toEqual([["111", 345], ["222", 103]]);
    expect(b.sides[0].supporters.map((s) => s.nickname)).toEqual(["Beto", "Ana"]);
    expect(b.sides[0].supporters[1].avatarUrl).toBe("https://x/ana.jpg");
  });

  it("lee el formato v1 (battleItems / battleGroups)", () => {
    const b = parseBattleArmies({ battleItems: [{ hostUserId: "9", battleGroups: [{ points: 10, users: [] }, { points: 4 }] }] })!;
    expect(b.sides.map((s) => s.points)).toEqual([10, 4]);
  });

  it("si no entiende el mensaje devuelve null", () => {
    expect(parseBattleArmies({})).toBeNull();
    expect(parseBattleArmies({ armies: { a: { hostscore: "x" } } })).toBeNull();
    expect(parseBattleArmies("hola")).toBeNull();
  });
});

describe("RoomStateEngine", () => {
  const armies = { armies: { "1": { hostscore: "5", anchorIdStr: "1" }, "2": { hostscore: "3", anchorIdStr: "2" } } };

  it("espectadores: emite solo cuando cambia", () => {
    const room = new RoomStateEngine();
    const fn = vi.fn();
    room.on("viewers", fn);
    room.ingestRoomUser({ viewerCount: 10 });
    room.ingestRoomUser({ viewerCount: 10 });
    room.ingestRoomUser({ viewerCount: 12 });
    expect(fn.mock.calls.map((c) => c[0])).toEqual([10, 12]);
    expect(room.getState().viewerCount).toBe(12);
  });

  it("une el nombre y la foto de los anfitriones al marcador", () => {
    const room = new RoomStateEngine();
    room.ingestBattleHosts({ battleUsers: [{ battleGroup: { user: { userId: "1", nickname: "Equipo Rojo", avatarThumb: { urlList: ["https://x/r.jpg"] } } } }] });
    room.ingestBattleArmies(armies);
    const sides = room.getState().battle!.sides;
    expect(sides[0]).toMatchObject({ id: "1", name: "Equipo Rojo", avatarUrl: "https://x/r.jpg", points: 5 });
    expect(sides[1].name).toBeUndefined();
  });

  it("un mensaje de batalla ilegible no borra el marcador anterior; reset lo limpia todo", () => {
    const room = new RoomStateEngine();
    room.ingestBattleArmies(armies);
    room.ingestBattleArmies({ basura: true });
    expect(room.getState().battle?.sides).toHaveLength(2);
    room.ingestRoomUser({ viewerCount: 3 });
    room.reset();
    expect(room.getState()).toEqual({ viewerCount: null, battle: null });
  });

  it("parseBattleHosts ignora usuarios sin id", () => {
    expect(parseBattleHosts({ battleUsers: [{ battleGroup: { user: { nickname: "x" } } }] }).size).toBe(0);
  });
});
