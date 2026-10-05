import { describe, expect, it } from "vitest";
import { EmoteScene } from "tiktok-live-connector";
import { extractGiftCatalogEntry, extractHostProfile, mapTiktokEvent, TikTokLiveSource } from "../src/tiktok-source.js";

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

  it("detecta seguidor/suscriptor también por userIdentity del mensaje (user.isFollower llega en false)", () => {
    // Forma real vista en una grabación: el usuario sigue al streamer pero
    // `user.isFollower` es false; la señal está en `userIdentity`.
    const evt = mapTiktokEvent("chat", {
      user: { displayId: "fan", nickname: "Fan", isFollower: false, isSubscribe: false },
      userIdentity: { isFollowerOfAnchor: true, isSubscriberOfAnchor: true },
      content: "hola",
    });

    expect(evt).toMatchObject({ isFollower: true, isSubscriber: true });
  });

  it("userIdentity en false no marca al usuario como seguidor", () => {
    const evt = mapTiktokEvent("chat", {
      user: { displayId: "fan", nickname: "Fan" },
      userIdentity: { isFollowerOfAnchor: false },
      content: "hola",
    });

    expect(evt?.isFollower).toBeUndefined();
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

  it("ingest emite giftCatalogEntry para un gift con id/nombre/imagen/costo", () => {
    const source = new TikTokLiveSource("alguien");
    const entries: unknown[] = [];
    source.on("giftCatalogEntry", (e) => entries.push(e));

    source.ingest("gift", {
      user: { displayId: "fan", nickname: "Fan" },
      giftId: "5487",
      gift: {
        id: "5487",
        name: "Finger Heart",
        diamondCount: 5,
        image: { urlList: ["https://cdn/finger.png"] },
        icon: { urlList: ["https://cdn/finger-icon.png"] },
      },
      repeatEnd: 1,
    });

    expect(entries).toEqual([
      { id: "5487", name: "Finger Heart", imageUrl: "https://cdn/finger.png", cost: 5 },
    ]);
  });
});

describe("extractGiftCatalogEntry", () => {
  it("extrae id/nombre/imagen/costo del gift crudo", () => {
    expect(
      extractGiftCatalogEntry({
        giftId: "5487",
        gift: {
          id: "5487",
          name: "Finger Heart",
          diamondCount: 5,
          image: { urlList: ["https://cdn/finger.png"] },
          icon: { urlList: ["https://cdn/finger-icon.png"] },
        },
      }),
    ).toEqual({
      id: "5487",
      name: "Finger Heart",
      imageUrl: "https://cdn/finger.png",
      cost: 5,
    });
  });

  it("usa gift.icon.urlList[0] como fallback si image viene vacío", () => {
    expect(
      extractGiftCatalogEntry({
        gift: {
          id: "5487",
          name: "Finger Heart",
          diamondCount: 5,
          image: { urlList: [] },
          icon: { urlList: ["https://cdn/finger-icon.png"] },
        },
      })?.imageUrl,
    ).toBe("https://cdn/finger-icon.png");
  });

  it("devuelve null si falta id, nombre, imagen o costo", () => {
    expect(extractGiftCatalogEntry({})).toBeNull();
    expect(
      extractGiftCatalogEntry({ gift: { name: "X", diamondCount: 1, image: { urlList: ["u"] } } }),
    ).toBeNull(); // sin id
    expect(
      extractGiftCatalogEntry({ gift: { id: "1", diamondCount: 1, image: { urlList: ["u"] } } }),
    ).toBeNull(); // sin nombre
    expect(
      extractGiftCatalogEntry({ gift: { id: "1", name: "X", image: { urlList: ["u"] } } }),
    ).toBeNull(); // sin costo
    expect(
      extractGiftCatalogEntry({ gift: { id: "1", name: "X", diamondCount: 1 } }),
    ).toBeNull(); // sin imagen (ni image ni icon)
  });
});

describe("extractHostProfile", () => {
  it("lee nombre y foto del dueño en roomInfo.data.owner (formato snake_case de TikTok)", () => {
    const info = {
      data: {
        status: 2,
        owner: {
          nickname: "Matt Keelan",
          display_id: "mattkeelan",
          avatar_thumb: { url_list: ["https://cdn/a-thumb.jpg", "https://cdn/b.jpg"] },
        },
      },
    };
    expect(extractHostProfile(info)).toEqual({ nickname: "Matt Keelan", avatarUrl: "https://cdn/a-thumb.jpg" });
  });

  it("acepta roomInfo.owner y claves camelCase (urlList)", () => {
    const info = { owner: { nickname: "Ana", avatarMedium: { urlList: ["https://cdn/m.jpg"] } } };
    expect(extractHostProfile(info)).toEqual({ nickname: "Ana", avatarUrl: "https://cdn/m.jpg" });
  });

  it("prefiere la foto pequeña pero cae a otra si falta", () => {
    const info = { data: { owner: { nickname: "X", avatar_large: { url_list: ["https://cdn/l.jpg"] } } } };
    expect(extractHostProfile(info)).toEqual({ nickname: "X", avatarUrl: "https://cdn/l.jpg" });
  });

  it("solo nombre o solo foto también sirven", () => {
    expect(extractHostProfile({ data: { owner: { nickname: "Solo" } } })).toEqual({ nickname: "Solo" });
    expect(extractHostProfile({ data: { owner: { avatar_thumb: { url_list: ["https://cdn/x.jpg"] } } } })).toEqual({
      avatarUrl: "https://cdn/x.jpg",
    });
  });

  it("devuelve null con datos ausentes o de forma inesperada", () => {
    for (const bad of [null, undefined, "x", 3, {}, { data: {} }, { data: { owner: {} } }, { data: { owner: { nickname: "" } } }]) {
      expect(extractHostProfile(bad)).toBeNull();
    }
  });

  it("ignora URLs que no son strings", () => {
    expect(extractHostProfile({ data: { owner: { avatar_thumb: { url_list: [null, 5] } } } })).toBeNull();
  });
});
