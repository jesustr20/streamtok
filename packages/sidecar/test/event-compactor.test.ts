import { describe, expect, it } from "vitest";
import { EventCompactor, slim } from "../src/event-compactor.js";

const user = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  nickname: `n${id}`,
  avatarThumb: { uri: `av-${id}`, urlList: ["https://a/1?sig=x", "https://a/2?sig=y", "https://a/3"] },
  badgeList: [{ name: "fan" }],
  payGrade: { level: 0 },
  followInfo: { followerCount: "10" },
  ...extra,
});

const like = (u: ReturnType<typeof user>, count: number, total: string) => ({
  type: "WebcastLikeMessage",
  data: { common: { msgId: String(Math.random()) }, user: u, count, total },
});

describe("slim", () => {
  it("deja una sola URL en las listas de imágenes y conserva el resto", () => {
    const out = slim({ img: { uri: "u", urlList: ["a", "b", "c"] }, n: 1 }) as any;
    expect(out).toEqual({ img: { uri: "u", urlList: ["a"] }, n: 1 });
  });

  it("quita los formatos de texto (colores/fuentes) en cualquier nivel", () => {
    const out = slim({ a: { defaultFormat: { color: "#fff" }, text: "x", pieces: [{ format: { bold: true }, v: 1 }] } }) as any;
    expect(out).toEqual({ a: { text: "x", pieces: [{ v: 1 }] } });
  });

  it("no muta la entrada", () => {
    const input = { img: { urlList: ["a", "b"] } };
    slim(input);
    expect(input.img.urlList).toHaveLength(2);
  });
});

describe("EventCompactor", () => {
  it("mensajes normales (chat, regalos, tipos desconocidos) siempre completos", () => {
    const c = new EventCompactor();
    const evt = { type: "WebcastChatMessage", data: { content: "hola", user: user("1") } };
    for (let i = 0; i < 3; i++) {
      const r = c.process("WebcastChatMessage", evt);
      expect(r.ref).toBeUndefined();
      expect((r.event as any).data.content).toBe("hola");
    }
    expect(c.process("WebcastAlgoNuevo", { type: "x", data: { a: 1 } }).ref).toBeUndefined();
  });

  it("likes: el primero de cada viewer va completo y los siguientes compactos con count y total", () => {
    const c = new EventCompactor();
    const first = c.process("WebcastLikeMessage", like(user("1"), 15, "100"));
    expect(first.ref).toBeUndefined();
    expect((first.event as any).data.user.nickname).toBe("n1");

    const second = c.process("WebcastLikeMessage", like(user("1"), 7, "107"));
    expect(second).toEqual({ ref: "viewer-seen", event: { userId: "1", count: 7, total: "107" } });

    const other = c.process("WebcastLikeMessage", like(user("2"), 1, "108"));
    expect(other.ref).toBeUndefined();
  });

  it("si el viewer cambia de insignias o nivel se vuelve a guardar completo", () => {
    const c = new EventCompactor();
    c.process("WebcastLikeMessage", like(user("1"), 1, "1"));
    const changed = c.process("WebcastLikeMessage", like(user("1", { payGrade: { level: 5 } }), 1, "2"));
    expect(changed.ref).toBeUndefined();
    expect((changed.event as any).data.user.payGrade.level).toBe(5);
  });

  it("cambios que no son de nivel (avatar firmado, seguidores) no cuentan como cambio", () => {
    const c = new EventCompactor();
    c.process("WebcastLikeMessage", like(user("1"), 1, "1"));
    const same = c.process(
      "WebcastLikeMessage",
      like(
        user("1", {
          avatarThumb: { uri: "av-1", urlList: ["https://otra/firma"] },
          followInfo: { followerCount: "11" },
        }),
        1,
        "2",
      ),
    );
    expect(same.ref).toBe("viewer-seen");
  });

  it("joins: igual por viewer, el repetido guarda solo el userId", () => {
    const c = new EventCompactor();
    const m = { type: "WebcastMemberMessage", data: { user: user("9"), common: { msgId: "1" } } };
    expect(c.process("WebcastMemberMessage", m).ref).toBeUndefined();
    expect(c.process("WebcastMemberMessage", m)).toEqual({ ref: "viewer-seen", event: { userId: "9" } });
  });

  it("estado repetido (batalla, ranking de la sala) solo se guarda si cambia", () => {
    const c = new EventCompactor();
    const armies = (score: string) => ({
      type: "WebcastLinkMicArmies",
      data: { common: { msgId: Math.random() }, battleId: "b", armies: { a: { userArmies: [{ userId: "1", score }] } } },
    });
    expect(c.process("WebcastLinkMicArmies", armies("3")).ref).toBeUndefined();
    expect(c.process("WebcastLinkMicArmies", armies("3")).ref).toBe("state-unchanged");
    const changed = c.process("WebcastLinkMicArmies", armies("9"));
    expect(changed.ref).toBeUndefined();
  });

  it("ranking de la sala: cambia el total pero no el ranking → compacto con los totales", () => {
    const c = new EventCompactor();
    const seq = (total: string) => ({
      type: "WebcastRoomUserSeqMessage",
      data: { ranks: [{ score: "5", user: user("1") }], total, totalUser: "99", anonymous: "2" },
    });
    expect(c.process("WebcastRoomUserSeqMessage", seq("10")).ref).toBeUndefined();
    expect(c.process("WebcastRoomUserSeqMessage", seq("11"))).toEqual({
      ref: "state-unchanged",
      event: { total: "11", totalUser: "99", anonymous: "2" },
    });
  });

  it("si el mensaje no tiene la forma esperada lo guarda completo (nunca pierde datos)", () => {
    const c = new EventCompactor();
    for (const bad of [null, "texto", { type: "x" }, { type: "x", data: { user: {} } }]) {
      const r = c.process("WebcastLikeMessage", bad);
      expect(r.ref).toBeUndefined();
    }
  });
});
