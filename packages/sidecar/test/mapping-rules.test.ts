import { describe, expect, it } from "vitest";
import type { ModHelloPayload, MappingRule } from "@streamtok/shared";
import { validateRules } from "../src/mapping-rules.js";

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

const validRule: MappingRule = {
  id: "r1",
  when: { event: "gift", giftId: 5655 },
  action: "arena_join",
  params: { character: "default", coins: 0 },
  passCoinsAsParam: "coins",
};

describe("validateRules", () => {
  it("acepta una regla válida contra el catálogo", () => {
    const result = validateRules([validRule], catalog);
    expect(result.ok).toBe(true);
  });

  it("rechaza una acción inexistente", () => {
    const result = validateRules([{ ...validRule, action: "no_existe" }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/no_existe/);
  });

  it("rechaza un parámetro que la acción no define", () => {
    const result = validateRules([{ ...validRule, params: { foo: 1 } }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/foo/);
  });

  it("rechaza un valor de parámetro de tipo incompatible", () => {
    const rule: MappingRule = {
      id: "r2",
      when: { event: "comment", command: "!carro" },
      action: "vehicle_spawn_random",
      params: { amount: "muchos" },
    };
    const result = validateRules([rule], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/amount/);
  });

  it("rechaza passCoinsAsParam que no es un parámetro de la acción", () => {
    const result = validateRules([{ ...validRule, passCoinsAsParam: "nope" }], catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/nope/);
  });

  it("rechaza command con un evento que no es comment", () => {
    const result = validateRules(
      [{ ...validRule, when: { event: "gift", command: "!carro" } }],
      catalog,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/command/);
  });

  it("sin catálogo valida solo la forma (permite reglas, rechaza basura)", () => {
    expect(validateRules([validRule], null).ok).toBe(true);
    expect(validateRules([{ id: 123 }], null).ok).toBe(false);
    expect(validateRules("basura", null).ok).toBe(false);
  });
});
