import { describe, expect, it } from "vitest";
import { EmoteScene } from "tiktok-live-connector";
import { mapTiktokEvent, TikTokLiveSource } from "../src/tiktok-source.js";

describe("mapTiktokEvent (normalización tiktok-live-connector → LiveEvent)", () => {
  it("normaliza un comentario plano a un LiveEvent válido", () => {
    const evt = mapTiktokEvent("chat", {
      user: { displayId: "fan123", nickname: "Fan 123" },
      content: "¡hola!",
    });

    expect(evt).toMatchObject({
      event: "comment",
      username: "@fan123",
      nickname: "Fan 123",
      text: "¡hola!",
    });
    expect(typeof evt?.timestamp).toBe("number");
  });

  it("normaliza un follow a un LiveEvent de tipo follow", () => {
    const evt = mapTiktokEvent("follow", {
      user: { displayId: "seguidor", nickname: "Seguidor" },
    });

    expect(evt).toMatchObject({
      event: "follow",
      username: "@seguidor",
      nickname: "Seguidor",
    });
  });

  it("normaliza el repeatEnd del streak de regalo (intermedio: false, final: true)", () => {
    const base = {
      user: { displayId: "fan", nickname: "Fan" },
      giftId: "5655",
      gift: { name: "Rose", diamondCount: 1, type: 1 },
    };

    // evento intermedio (repeatEnd: 0): pasa con repeatEnd: false
    const intermedio = mapTiktokEvent("gift", { ...base, repeatCount: 2, repeatEnd: 0 });
    expect(intermedio).toMatchObject({
      event: "gift",
      username: "@fan",
      giftId: 5655,
      giftName: "Rose",
      coins: 2,
      repeatEnd: false,
    });

    // evento final (repeatEnd: 1): repeatEnd: true con coins totales
    const final = mapTiktokEvent("gift", { ...base, repeatCount: 3, repeatEnd: 1 });
    expect(final).toMatchObject({
      event: "gift",
      username: "@fan",
      nickname: "Fan",
      giftId: 5655,
      giftName: "Rose",
      coins: 3,
      repeatEnd: true,
    });
  });

  it("no lanza excepción con eventos crudos malformados (los descarta)", () => {
    expect(() => mapTiktokEvent("gift", null)).not.toThrow();
    expect(() => mapTiktokEvent("chat", "garbage")).not.toThrow();
    expect(() => mapTiktokEvent("gift", { user: null, giftId: "abc" })).not.toThrow();

    expect(mapTiktokEvent("gift", {})).toBeNull();
    expect(mapTiktokEvent("chat", {})).toBeNull();
    expect(mapTiktokEvent("gift", { user: { displayId: "fan" }, giftId: "no-es-numero" })).toBeNull();
  });

  it("propaga metadata de viewer (seguidor/suscriptor/moderador) cuando la reporta", () => {
    const evt = mapTiktokEvent("chat", {
      user: {
        displayId: "fan",
        nickname: "Fan",
        isFollower: true,
        isSubscribe: true,
        userAttr: { isAdmin: true },
      },
      content: "hola",
    });

    expect(evt).toMatchObject({
      event: "comment",
      isFollower: true,
      isSubscriber: true,
      isModerator: true,
    });
  });

  it("no inventa flags de viewer que la fuente no reporta", () => {
    const evt = mapTiktokEvent("chat", {
      user: { displayId: "fan", nickname: "Fan" },
      content: "hola",
    });

    expect(evt?.isFollower).toBeUndefined();
    expect(evt?.isSubscriber).toBeUndefined();
    expect(evt?.isModerator).toBeUndefined();
  });

  it("normaliza un emote de suscriptor a un LiveEvent emote/subscriber", () => {
    const evt = mapTiktokEvent("emote", {
      user: { displayId: "sub", nickname: "Sub" },
      emoteList: [{ emoteId: "sub_emote_1", emoteScene: EmoteScene.SUBSCRIPTION }],
    });

    expect(evt).toMatchObject({
      event: "emote",
      username: "@sub",
      emoteId: "sub_emote_1",
      emoteScene: "subscriber",
    });
  });

  it("normaliza un sticker del Fan Club a un LiveEvent emote/fanClub", () => {
    const evt = mapTiktokEvent("emote", {
      user: { displayId: "fanclub", nickname: "FanClub" },
      emoteList: [{ emoteId: "sticker_1", emoteScene: EmoteScene.FANS_CLUB }],
    });

    expect(evt).toMatchObject({
      event: "emote",
      username: "@fanclub",
      emoteId: "sticker_1",
      emoteScene: "fanClub",
    });
  });

  it("descarta un emote sin emoteId o sin remitente", () => {
    expect(mapTiktokEvent("emote", {})).toBeNull();
    expect(mapTiktokEvent("emote", { user: { displayId: "x" }, emoteList: [] })).toBeNull();
    expect(
      mapTiktokEvent("emote", { user: { displayId: "x" }, emoteList: [{ emoteScene: EmoteScene.FANS_CLUB }] }),
    ).toBeNull();
  });
});

describe("TikTokLiveSource", () => {
  it("ingest emite 'event' para eventos válidos y loguea/descarta los inválidos", () => {
    const source = new TikTokLiveSource("alguien");

    const events: unknown[] = [];
    const logs: unknown[] = [];
    source.on("event", (e) => events.push(e));
    source.on("log", (e) => logs.push(e));

    const ok = source.ingest("chat", {
      user: { displayId: "fan", nickname: "Fan" },
      content: "hola",
    });
    expect(ok).not.toBeNull();
    expect(events).toHaveLength(1);

    const dropped = source.ingest("gift", {});
    expect(dropped).toBeNull();
    expect(events).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: "warn" });
  });
});
