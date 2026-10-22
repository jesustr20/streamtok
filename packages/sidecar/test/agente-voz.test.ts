import { describe, expect, it } from "vitest";
import { AgentConfigSchema, PICK_VOICE_JS, overlayPage, pickVoice, type VoiceLike } from "@streamtok/shared";

const WINDOWS: VoiceLike[] = [
  { name: "Microsoft Helena - Spanish (Spain)", lang: "es-ES" },
  { name: "Microsoft Pablo - Spanish (Spain)", lang: "es-ES" },
  { name: "Microsoft Sabina - Spanish (Mexico)", lang: "es-MX" },
  { name: "Microsoft Raul - Spanish (Mexico)", lang: "es-MX" },
  { name: "Microsoft Zira - English (United States)", lang: "en-US" },
  { name: "Microsoft Elena Online (Natural) - Spanish (Argentina)", lang: "es-AR" },
  { name: "Microsoft Jorge Online (Natural) - Spanish (Mexico)", lang: "es-MX" },
];

describe("pickVoice", () => {
  it("mujer: prefiere español latino y neuronal", () => {
    expect(pickVoice(WINDOWS, { gender: "female", voiceName: "" })?.name).toBe("Microsoft Elena Online (Natural) - Spanish (Argentina)");
  });
  it("hombre: prefiere español latino y neuronal", () => {
    expect(pickVoice(WINDOWS, { gender: "male", voiceName: "" })?.name).toBe("Microsoft Jorge Online (Natural) - Spanish (Mexico)");
  });
  it("sin las neuronales, mujer = Sabina (latina) antes que Helena", () => {
    const basic = WINDOWS.filter((v) => !/Online/.test(v.name));
    expect(pickVoice(basic, { gender: "female", voiceName: "" })?.name).toBe("Microsoft Sabina - Spanish (Mexico)");
    expect(pickVoice(basic, { gender: "male", voiceName: "" })?.name).toBe("Microsoft Raul - Spanish (Mexico)");
  });
  it("el nombre exacto manda", () => {
    expect(pickVoice(WINDOWS, { gender: "female", voiceName: "Microsoft Pablo - Spanish (Spain)" })?.name).toBe("Microsoft Pablo - Spanish (Spain)");
  });
  it("ignora lo que no es español y devuelve undefined si no hay", () => {
    expect(pickVoice([{ name: "Microsoft Zira", lang: "en-US" }], { gender: "female", voiceName: "" })).toBeUndefined();
    expect(pickVoice([], { gender: "male", voiceName: "" })).toBeUndefined();
  });
  it("«Female»/«Male» en el nombre (Chrome en Linux/Android)", () => {
    const v: VoiceLike[] = [
      { name: "Spanish Male", lang: "es-ES" },
      { name: "Spanish Female", lang: "es-ES" },
    ];
    expect(pickVoice(v, { gender: "female", voiceName: "" })?.name).toBe("Spanish Female");
    expect(pickVoice(v, { gender: "male", voiceName: "" })?.name).toBe("Spanish Male");
  });
  it("la versión JS del overlay elige igual que la de TypeScript", () => {
    const js = new Function(`${PICK_VOICE_JS}; return pickVoice;`)() as (v: VoiceLike[], g: string, n: string) => VoiceLike | null;
    const sets: VoiceLike[][] = [WINDOWS, WINDOWS.filter((v) => !/Online/.test(v.name)), WINDOWS.slice(4, 5), []];
    for (const set of sets) {
      for (const gender of ["female", "male"] as const) {
        for (const voiceName of ["", "Microsoft Pablo - Spanish (Spain)", "no existe"]) {
          expect(js(set, gender, voiceName)?.name).toBe(pickVoice(set, { gender, voiceName })?.name);
        }
      }
    }
  });
});

describe("voz del agente", () => {
  it("por defecto: activada, mujer, velocidad y volumen normales, sin leer la pregunta", () => {
    expect(AgentConfigSchema.parse({}).voice).toMatchObject({ enabled: true, gender: "female", voiceName: "", rate: 1, volume: 1, readQuestion: false });
  });
  it("por defecto sigue con la voz del equipo: la de la nube hay que elegirla (y trae voz, modelo, estilo y tope)", () => {
    expect(AgentConfigSchema.parse({}).voice).toMatchObject({ provider: "system", geminiVoice: "Sulafat", geminiModel: "gemini-3.8-flash-tts", maxCloudCalls: 400 });
    expect(AgentConfigSchema.parse({}).voice.style).toContain("cálida");
    expect(AgentConfigSchema.safeParse({ voice: { provider: "otra" } }).success).toBe(false);
    // una configuración guardada antes de esta versión (sin los campos nuevos) sigue siendo válida
    expect(AgentConfigSchema.safeParse({ voice: { enabled: true, gender: "male", voiceName: "", rate: 1, volume: 1, readQuestion: false } }).success).toBe(true);
  });
  it("rechaza velocidades fuera de rango", () => {
    expect(AgentConfigSchema.safeParse({ voice: { rate: 5 } }).success).toBe(false);
  });
  it("el overlay trae la lectura en voz alta y el selector de voz", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain("speechSynthesis");
    expect(html).toContain("function pickVoice(");
    expect(html).toContain("SpeechSynthesisUtterance");
  });
  it("el script de la página del agente es JavaScript válido", () => {
    const html = overlayPage("agente", 7331);
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
    expect(() => new Function(script)).not.toThrow();
  });
});
