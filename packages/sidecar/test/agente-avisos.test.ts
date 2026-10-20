import { describe, expect, it } from "vitest";
import { AgentConfigSchema, buildTips, type AgentConfig } from "@streamtok/shared";
import { AgenteEngine } from "../src/agente.js";

function setup(config: Partial<AgentConfig> = {}, canShowTip?: () => boolean) {
  let t = 1_000_000;
  const engine = new AgenteEngine({
    store: { load: () => ({ config: AgentConfigSchema.parse(config) }), save: async () => {} },
    now: () => t,
    random: () => 0,
    responder: async (q) => `R:${q}`,
    canShowTip,
  });
  return { engine, advance: (ms: number) => void (t += ms) };
}
const cfg = (c: Record<string, unknown> = {}) => AgentConfigSchema.parse(c);

describe("buildTips", () => {
  it("explica cómo preguntar y quién puede, según la configuración", () => {
    const tips = buildTips(cfg({ name: "Luna", command: "!luna" }));
    expect(tips[0]).toBe("Soy Luna. Escribe !luna y tu pregunta en el chat. Puedes preguntar si sigues el canal, compartes el LIVE, eres del Fan Club o mandas un regalo.");
  });
  it("con un solo requisito no lleva «o»", () => {
    const tips = buildTips(cfg({ eligibility: { follow: true, share: false, fanClub: false, gift: false } }));
    expect(tips[0]).toContain("Puedes preguntar si sigues el canal.");
    expect(tips).toHaveLength(1); // sin regalos no hay aviso de prioridad
  });
  it("el aviso de prioridad menciona la espera y el de trivia solo sale si está activada", () => {
    expect(buildTips(cfg({ freeEverySec: 60 }))[1]).toContain("una cada 60 segundos");
    expect(buildTips(cfg()).some((t) => t.includes("trivia"))).toBe(false);
    expect(buildTips(cfg({ trivia: { enabled: true } })).some((t) => t.includes("trivia"))).toBe(true);
  });
  it("sin requisitos no hay aviso de «cómo preguntar» y los tuyos van al final", () => {
    const tips = buildTips(cfg({ eligibility: { follow: false, share: false, fanClub: false, gift: false }, tips: { custom: ["Sígueme en YG"] } }));
    expect(tips).toEqual(["Sígueme en YG"]);
  });
  it("los avisos propios se validan (máx. 5 y 140 caracteres)", () => {
    expect(AgentConfigSchema.safeParse({ tips: { custom: Array(6).fill("a") } }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ tips: { custom: ["x".repeat(141)] } }).success).toBe(false);
  });
});

describe("AgenteEngine: avisos periódicos", () => {
  it("salen cada everySec con el agente libre, rotando", () => {
    const { engine, advance } = setup({ tips: { everySec: 60 } as any });
    engine.tick();
    expect(engine.getState().tip).toBeUndefined(); // no al arrancar
    advance(61_000);
    engine.tick();
    const first = engine.getState().tip!;
    expect(first.text).toContain("Escribe !ia");
    advance(30_000); // se va después de leerse
    engine.tick();
    expect(engine.getState().tip).toBeUndefined();
    advance(40_000);
    engine.tick();
    expect(engine.getState().tip!.text).toContain("prioridad");
    expect(engine.getState().tip!.id).not.toBe(first.id);
  });

  it("no salen apagados, ni con preguntas esperando, ni si la trivia lo bloquea", () => {
    const off = setup({ tips: { enabled: false } as any });
    off.advance(400_000);
    off.engine.tick();
    expect(off.engine.getState().tip).toBeUndefined();

    const busy = setup();
    busy.engine.ask("A", "hola");
    busy.advance(400_000);
    busy.engine.tick(); // atiende la pregunta en vez del aviso
    expect(busy.engine.getState().tip).toBeUndefined();

    let blocked = true;
    const t = setup({}, () => !blocked);
    t.advance(400_000);
    t.engine.tick();
    expect(t.engine.getState().tip).toBeUndefined();
    blocked = false;
    t.engine.tick();
    expect(t.engine.getState().tip).toBeDefined();
  });

  it("una pregunta nueva quita el aviso de pantalla", () => {
    const { engine, advance } = setup();
    advance(301_000);
    engine.tick();
    expect(engine.getState().tip).toBeDefined();
    engine.ask("Ana", "hola");
    engine.tick();
    expect(engine.getState().tip).toBeUndefined();
    expect(engine.getState().current?.name).toBe("Ana");
  });

  it("«mostrar ahora» funciona y avisa si no hay nada que mostrar", () => {
    const { engine } = setup();
    expect(engine.showTip()).toBe(true);
    expect(engine.getState().tip).toBeDefined();
    const none = setup({ eligibility: { follow: false, share: false, fanClub: false, gift: false } });
    expect(none.engine.showTip()).toBe(false);
  });
});
