import { describe, expect, it } from "vitest";
import type { Accion, Evento, ModHelloPayload } from "@streamtok/shared";
import { validateAcciones, validateEventos } from "../src/acciones-eventos.js";

const catalog: ModHelloPayload = {
  mod: "gtav-chaos",
  version: "0.9.0",
  actions: [
    {
      id: "arena_join",
      name: "Unirse a la arena",
      category: "arena",
      icon: "arena",
      description: "El viewer entra a la pelea",
      supportsNameTag: true,
      params: [
        { name: "character", type: "enum", default: "default", options: ["default", "npc"] },
        { name: "coins", type: "int", default: 0 },
      ],
    },
    {
      id: "vehicle_spawn_random",
      name: "Aparecer vehículo",
      category: "vehicle",
      icon: "vehicle",
      description: "Aparece un vehículo",
      supportsNameTag: false,
      params: [{ name: "amount", type: "int", default: 1 }],
    },
  ],
};

function accion(overrides: Partial<Accion> = {}): Accion {
  return {
    id: "a1",
    nombre: "Atacar",
    descripcion: "",
    duracionSeg: 0,
    puntos: 0,
    pantalla: null,
    media: { animacion: false, imagen: false, sonido: false, video: false },
    comandos: [{ modActionId: "arena_join", params: { character: "default" } }],
    repetirConComboDeRegalos: false,
    ...overrides,
  };
}

function evento(overrides: Partial<Evento> = {}): Evento {
  return {
    id: "e1",
    activo: true,
    quien: "todos",
    porque: "seguir",
    accionesTodas: ["a1"],
    accionesAleatorias: [],
    ...overrides,
  };
}

describe("validateAcciones", () => {
  it("acepta una acción válida contra el catálogo", () => {
    const result = validateAcciones([accion()], catalog);
    expect(result.ok).toBe(true);
  });

  it("rechaza un comando con modActionId inexistente", () => {
    const result = validateAcciones(
      [accion({ comandos: [{ modActionId: "no_existe", params: {} }] })],
      catalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/no_existe/);
  });

  it("rechaza un parámetro que la acción del mod no define", () => {
    const result = validateAcciones(
      [accion({ comandos: [{ modActionId: "arena_join", params: { foo: 1 } }] })],
      catalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/foo/);
  });

  it("sin catálogo valida solo la forma", () => {
    expect(validateAcciones([accion()], null).ok).toBe(true);
    expect(validateAcciones([{ id: 1 }], null).ok).toBe(false);
    expect(validateAcciones("basura", null).ok).toBe(false);
  });
});

describe("validateEventos", () => {
  it("acepta un evento válido", () => {
    const result = validateEventos([evento()]);
    expect(result.ok).toBe(true);
  });

  it("acepta un evento con ambas listas de acciones vacías", () => {
    const result = validateEventos([evento({ accionesTodas: [], accionesAleatorias: [] })]);
    expect(result.ok).toBe(true);
  });

  it("migra eventos viejos (modoDisparo + accionesIds) a accionesTodas/accionesAleatorias", () => {
    const viejoTodas = {
      id: "e-old",
      activo: true,
      quien: "todos",
      porque: "seguir",
      modoDisparo: "todas",
      accionesIds: ["a1", "a2"],
    };
    const r1 = validateEventos([viejoTodas]);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.eventos[0].accionesTodas).toEqual(["a1", "a2"]);
      expect(r1.eventos[0].accionesAleatorias).toEqual([]);
    }

    const viejoAleatorio = { ...viejoTodas, modoDisparo: "unaAlAzar" };
    const r2 = validateEventos([viejoAleatorio]);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.eventos[0].accionesTodas).toEqual([]);
      expect(r2.eventos[0].accionesAleatorias).toEqual(["a1", "a2"]);
    }
  });

  it("porque comando requiere un comando que empiece con ! o /", () => {
    expect(validateEventos([evento({ porque: "comando" })]).ok).toBe(false);
    expect(validateEventos([evento({ porque: "comando", comando: "carro" })]).ok).toBe(false);
    expect(validateEventos([evento({ porque: "comando", comando: "!carro" })]).ok).toBe(true);
    expect(validateEventos([evento({ porque: "comando", comando: "/carro" })]).ok).toBe(true);
  });

  it("porque regaloEspecifico requiere giftId", () => {
    expect(validateEventos([evento({ porque: "regaloEspecifico" })]).ok).toBe(false);
    expect(
      validateEventos([evento({ porque: "regaloEspecifico", giftId: "5655" })]).ok,
    ).toBe(true);
  });

  it("porque emoteSuscriptor requiere emoteId", () => {
    expect(validateEventos([evento({ porque: "emoteSuscriptor" })]).ok).toBe(false);
    expect(
      validateEventos([evento({ porque: "emoteSuscriptor", emoteId: "emo1" })]).ok,
    ).toBe(true);
  });

  it("porque stickerFanClub requiere stickerId", () => {
    expect(validateEventos([evento({ porque: "stickerFanClub" })]).ok).toBe(false);
    expect(
      validateEventos([evento({ porque: "stickerFanClub", stickerId: "stk1" })]).ok,
    ).toBe(true);
  });

  it("porque compraTiktokShop requiere nombreProductoContiene", () => {
    expect(validateEventos([evento({ porque: "compraTiktokShop" })]).ok).toBe(false);
    expect(
      validateEventos([evento({ porque: "compraTiktokShop", nombreProductoContiene: "gorra" })]).ok,
    ).toBe(true);
  });

  it("quien usuarioEspecifico requiere usuarioEspecifico", () => {
    expect(validateEventos([evento({ quien: "usuarioEspecifico" })]).ok).toBe(false);
    expect(
      validateEventos([evento({ quien: "usuarioEspecifico", usuarioEspecifico: "@fan" })]).ok,
    ).toBe(true);
  });

  it("aplica defaults: likes→15, regaloValorMinimo→1, donanteTop→3", () => {
    const result = validateEventos([
      evento({ porque: "likes" }),
      evento({ porque: "regaloValorMinimo" }),
      evento({ porque: "comando", comando: "!x", quien: "donanteTop" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventos[0].cantidadMinimaLikes).toBe(15);
    expect(result.eventos[1].valorMinimoMonedas).toBe(1);
    expect(result.eventos[2].numeroDonantesTop).toBe(3);
    expect(result.eventos[2].nivelEquipoRequerido).toBe(0);
  });
});
