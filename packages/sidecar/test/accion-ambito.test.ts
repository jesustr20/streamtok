import { describe, expect, it } from "vitest";
import { AccionSchema } from "@streamtok/shared";
import { validateAcciones } from "../src/acciones-eventos.js";

const base = { id: "a1", nombre: "Hola", descripcion: "", duracionSeg: 0, puntos: 0, pantalla: null, media: { animacion: false, imagen: false, sonido: false, video: false }, comandos: [] };

describe("ámbito de la acción (ADR 0023)", () => {
  it("sin ámbito sigue valiendo (es de Juegos) y «stickers» se conserva al validar", () => {
    expect(AccionSchema.parse(base).ambito).toBeUndefined();
    expect(AccionSchema.safeParse({ ...base, ambito: "otro" }).success).toBe(false);
    const r = validateAcciones([{ ...base, ambito: "stickers" }], null);
    expect(r.ok && r.acciones[0].ambito).toBe("stickers");
  });
});
