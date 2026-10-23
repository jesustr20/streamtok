import { describe, expect, it } from "vitest";
import { AgentConfigSchema, AgentCurrentSchema } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";
import { parseExpression, systemPrompt } from "../src/agente-guard.js";
import { ModelService, type FetchLike } from "../src/agente-model.js";

describe("parseExpression (la IA elige su emoción y su gesto)", () => {
  it("separa la etiqueta del texto", () => {
    expect(parseExpression("[alegre, saludar] ¡Hola a todos!")).toEqual({ text: "¡Hola a todos!", mood: "happy", gesture: "wave" });
  });

  it("entiende acentos, mayúsculas y otros separadores", () => {
    expect(parseExpression("[Tímida | Pensar] Mmm.")).toEqual({ text: "Mmm.", gesture: "shy" });
    expect(parseExpression("[EMOCIONADA; saltar] ¡Wow!")).toMatchObject({ text: "¡Wow!", mood: "excited", gesture: "jump" });
    expect(parseExpression("[misterio]  Shh.")).toEqual({ text: "Shh.", mood: "mystery" });
  });

  it("sin etiqueta deja el texto igual", () => {
    expect(parseExpression("Ocho planetas.")).toEqual({ text: "Ocho planetas." });
    expect(parseExpression("Hay [3] cosas.")).toEqual({ text: "Hay [3] cosas." });
  });

  it("solo acepta palabras de la lista: lo demás se ignora, pero la etiqueta se quita igual", () => {
    expect(parseExpression("[hackear, borrar todo] Texto.")).toEqual({ text: "Texto." });
    expect(parseExpression("[alegre, explotar] Texto.")).toEqual({ text: "Texto.", mood: "happy" });
  });

  it("una etiqueta larguísima no se toma por etiqueta", () => {
    const largo = `[${"a".repeat(60)}] texto`;
    expect(parseExpression(largo)).toEqual({ text: largo });
  });
});

const memKeys = { load: () => ({ keys: { deepseek: "k-123456789" } }), save: async () => {} };

describe("el prompt y la respuesta con expresión", () => {
  it("el prompt pide la etiqueta con las emociones y gestos permitidos", () => {
    const p = systemPrompt(AgentConfigSchema.parse({}));
    expect(p).toContain("[alegre, saludar]");
    for (const w of ["calma", "alegre", "emocionada", "misterio", "saludar", "asentir", "pensar", "saltar", "reir", "encogerse", "timida", "ninguno"]) expect(p).toContain(w);
  });

  it("el modelo: la etiqueta se separa antes de limpiar (la barra | no la rompe) y el texto queda limpio", async () => {
    const reply = (text: string): FetchLike => async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
    const svc = new ModelService({ keys: memKeys, fetchImpl: reply("[alegre|saludar] **Hola** https://x.com") });
    const out = await svc.respond("¿hola?", { name: "Ana", config: AgentConfigSchema.parse({}) });
    expect(out).toEqual({ text: "Hola", mood: "happy", gesture: "wave" });
    const plain = new ModelService({ keys: memKeys, fetchImpl: reply("Ocho planetas.") });
    expect(await plain.respond("¿cuántos?", { name: "Ana", config: AgentConfigSchema.parse({}) })).toBe("Ocho planetas.");
  });
});

describe("el motor guarda la expresión de la respuesta", () => {
  it("current trae mood y gesture, sin la etiqueta en el texto, y el esquema los acepta", async () => {
    const engine = new AgenteEngine({
      store: { load: () => ({ config: AgentConfigSchema.parse({ enabled: true }) }), save: async () => {} },
      responder: async () => "[emocionada, saltar] ¡Qué buena pregunta!",
    });
    engine.ask("Ana", "hola", 0);
    engine.tick();
    await engine.flush();
    const cur = engine.getState().current!;
    expect(cur.answer).toBe("¡Qué buena pregunta!");
    expect(cur.mood).toBe("excited");
    expect(cur.gesture).toBe("jump");
    expect(AgentCurrentSchema.safeParse(cur).success).toBe(true);
  });

  it("una respuesta sin etiqueta no trae expresión", async () => {
    const engine = new AgenteEngine({
      store: { load: () => ({ config: AgentConfigSchema.parse({ enabled: true }) }), save: async () => {} },
      responder: async () => "Ocho planetas.",
    });
    engine.ask("Ana", "hola", 0);
    engine.tick();
    await engine.flush();
    const cur = engine.getState().current!;
    expect(cur.mood).toBeUndefined();
    expect(cur.gesture).toBeUndefined();
  });
});
