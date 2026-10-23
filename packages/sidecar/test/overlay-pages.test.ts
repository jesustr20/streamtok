import { AgentConfigSchema, FORMAT_TIMER_JS, GOAL_REMAINING_JS, goalRemainingText, RATE_TEXT_JS, TimerConfigSchema, formatTimerMs, overlayPage, OVERLAY_DESIGNS, timerRateText } from "@streamtok/shared";
import { describe, expect, it } from "vitest";

describe("overlayPage (compartida entre el servidor y la vista previa de la app)", () => {
  it("sin opciones no fuerza ningún diseño", () => {
    const html = overlayPage("timer", 7331);
    expect(html).toContain('var DESIGN_OVERRIDE = "";');
    expect(html).toContain("var WS_PORT = 7331;");
  });

  it("la vista previa puede forzar un diseño sin depender de ?design=", () => {
    const html = overlayPage("wins", 7331, { design: "streamtok" });
    expect(html).toContain('var DESIGN_OVERRIDE = "streamtok";');
    expect(html).toContain('var KIND = "wins";');
  });

  it("un diseño con comillas no rompe el script", () => {
    const html = overlayPage("timer", 7331, { design: 'x"</script><b>' });
    expect(html).not.toContain('</script><b>');
  });
});

describe("formato del tiempo del timer", () => {
  const casos: [number, string][] = [
    [0, "00:00"],
    [1, "00:01"],
    [25_000, "00:25"],
    [60_000, "01:00"],
    [3_599_000, "59:59"],
    [3_600_000, "01:00:00"],
    [3_661_000, "01:01:01"],
    [36_000_000, "10:00:00"],
    [90_061_000, "25:01:01"],
  ];

  it.each(casos)("formatTimerMs(%i) = %s", (ms, esperado) => {
    expect(formatTimerMs(ms)).toBe(esperado);
  });

  it("la copia en JavaScript de la página da lo mismo que la de TypeScript", () => {
    const fmtTimer = new Function(`${FORMAT_TIMER_JS}; return fmtTimer;`)() as (ms: number) => string;
    for (const ms of [0, 1, 999, 1000, 25_000, 59_999, 60_000, 3_599_001, 3_600_000, 7_325_500, 86_400_000]) {
      expect(fmtTimer(ms)).toBe(formatTimerMs(ms));
    }
  });

  it("la página del timer incluye la función", () => {
    expect(overlayPage("timer", 7331)).toContain("function fmtTimer(ms)");
  });
});

describe("overlay de wins con conteo negativo", () => {
  it("la barra de progreso no baja de 0 %", () => {
    expect(overlayPage("wins", 7331)).toContain("Math.max(0, Math.min(100,");
  });
});

describe("título y equivalencia del timer", () => {
  const cfg = (coin: number, mult?: { active: boolean; value: number }) =>
    TimerConfigSchema.parse({ perType: { coin }, ...(mult ? { multiplier: mult } : {}) });

  it("por defecto no hay título y la equivalencia está activada", () => {
    const d = TimerConfigSchema.parse({});
    expect(d.title).toBe("");
    expect(d.showRate).toBe(true);
  });

  it("la equivalencia sale de los segundos por moneda", () => {
    expect(timerRateText(cfg(3))).toBe("1 coin = 3 s");
    expect(timerRateText(cfg(0.5))).toBe("1 coin = 0.5 s");
    expect(timerRateText(cfg(-2))).toBe("1 coin = -2 s");
  });

  it("sin segundos por moneda no muestra nada", () => {
    expect(timerRateText(cfg(0))).toBe("");
  });

  it("con multiplicador activo muestra lo que de verdad suma", () => {
    expect(timerRateText(cfg(2, { active: true, value: 1.5 }))).toBe("1 coin = 3 s");
    expect(timerRateText(cfg(2, { active: false, value: 1.5 }))).toBe("1 coin = 2 s");
  });

  it("la copia en JavaScript de la página da lo mismo que la de TypeScript", () => {
    const rateText = new Function(`${RATE_TEXT_JS}; return rateText;`)() as (t: unknown) => string;
    for (const c of [cfg(0), cfg(3), cfg(0.5), cfg(-2), cfg(2, { active: true, value: 1.5 }), cfg(1, { active: true, value: 1.25 })]) {
      expect(rateText(c)).toBe(timerRateText(c));
    }
  });

  it("la página del timer lleva título y equivalencia", () => {
    const html = overlayPage("timer", 7331);
    expect(html).toContain('id="ttl"');
    expect(html).toContain('id="rate"');
    expect(html).toContain("function rateText(t)");
  });

  it("el título se escribe como texto, no como HTML", () => {
    expect(overlayPage("timer", 7331)).toContain("ttlEl.textContent");
  });
});

describe("tamaño del temporizador", () => {
  it("el timer ignora la escala guardada: tiene tamaño fijo", () => {
    expect(overlayPage("timer", 7331)).toContain('KIND === "timer" ? 1 : style.scale || 1');
  });

  it("Wins sigue admitiendo escala", () => {
    expect(overlayPage("wins", 7331)).toContain('var KIND = "wins";');
    expect(overlayPage("wins", 7331)).toContain('"--scale"');
  });
});

describe("la página no recorta su propio contenido", () => {
  it("el recorte lo hace solo la ventana (html), no el body: con escala > 1 el contenido sale de la caja del body", () => {
    for (const kind of ["timer", "wins"] as const) {
      const html = overlayPage(kind, 7331);
      expect(html).toMatch(/html \{ overflow: hidden; \}/);
      expect(html).not.toMatch(/html, body \{[^}]*overflow: hidden/);
      expect(html).not.toMatch(/body \{[^}]*overflow: hidden/);
    }
  });
});

describe("overlay de meta", () => {
  it("usa el canal goals y la instancia pedida", () => {
    const html = overlayPage("meta", 7331, { id: "monedas" });
    expect(html).toContain('var GOAL_ID = "monedas";');
    expect(html).toContain('channel: "goals"');
    expect(html).not.toContain('channel: "overlays"');
  });

  it("trae el diseño de pastilla con icono y la rotación de metas", () => {
    const html = overlayPage("meta", 7331, { id: "rotativa" });
    expect(html).toContain('body[data-design="interactive"] .pill');
    expect(html).toContain('var ROTATION_ID = "rotativa"');
    expect(html).toContain("g.config.rotate");
  });

  it("la copia en JavaScript del texto 'faltan' da lo mismo que la de TypeScript", () => {
    const fn = new Function(`${GOAL_REMAINING_JS}; return goalRemainingText;`)() as (c: number, t: number) => string;
    for (const [c, t] of [[0, 10], [9, 10], [10, 10], [15, 10], [-3, 5]]) expect(fn(c, t)).toBe(goalRemainingText(c, t));
  });

  it("con textos propios: \"Hay 380 likes por conseguir\", y la versión JS coincide", () => {
    expect(goalRemainingText(620, 1000, "Hay ", " likes por conseguir")).toBe("Hay 380 likes por conseguir");
    expect(goalRemainingText(620, 1000, "", " más")).toBe("380 más");
    expect(goalRemainingText(1000, 1000, "Hay ", " likes")).toBe("¡Meta cumplida!");
    const fn = new Function(`${GOAL_REMAINING_JS}; return goalRemainingText;`)() as (c: number, t: number, b?: string, a?: string) => string;
    for (const [b, a] of [["", ""], ["Hay ", " likes"], ["", " más"], ["Faltan ", ""]]) {
      for (const [c, t] of [[0, 10], [9, 10], [10, 10], [15, 10]]) expect(fn(c, t, b, a)).toBe(goalRemainingText(c, t, b, a));
    }
  });

  it("la pastilla en cuenta atrás dice \"Quedan N\"", () => {
    expect(overlayPage("meta", 7331)).toContain('"Quedan "');
  });
});

describe("overlay de nivel", () => {
  it("se conecta al canal alertas con su id y trae los tres diseños", () => {
    const html = overlayPage("nivel", 7331, { id: "comunidad" });
    expect(html).toContain('var KIND = "nivel";');
    expect(html).toContain('var ALERT_ID = "comunidad";');
    expect(html).toContain('channel: "alertas"');
    for (const d of OVERLAY_DESIGNS.nivel) expect(html).toContain(`[data-design="${d.id}"]`);
  });

  it("la vista previa activa el modo demo y las páginas del stream no", () => {
    expect(overlayPage("nivel", 7331, { id: "todas", demo: true })).toContain("var DEMO_MODE = true;");
    expect(overlayPage("nivel", 7331, { id: "todas" })).toContain("var DEMO_MODE = false;");
  });

  it("marca la página como lista al recibir la configuración", () => {
    expect(overlayPage("nivel", 7331)).toContain('setAttribute("data-ready", "1")');
  });

  it("los diseños animados traen anillo, partículas y contador de nivel", () => {
    const html = overlayPage("nivel", 7331, { id: "todas" });
    for (const id of ["anillo", "celebracion"]) expect(OVERLAY_DESIGNS.nivel.map((d) => d.id)).toContain(id);
    expect(html).toContain("function burst(");
    expect(html).toContain("function countUp(");
    expect(html).toContain("@keyframes alRing");
    expect(html).toContain('id="fx"');
  });
});

describe("overlay de duelo", () => {
  it("el ejemplo de la vista previa suma el valor del regalo de cada lado", () => {
    const html = overlayPage("duelo", 7331, { id: "regalo-vs-regalo", demo: true });
    expect(html).toContain("function unitOf(i)");
    expect(html).toContain("c.cost");
  });

  it("la vista previa usa datos reales en cuanto el duelo tiene puntos", () => {
    const html = overlayPage("duelo", 7331, { id: "regalo-vs-regalo", demo: true });
    expect(html).toContain("function demoNow()");
    expect(html).toContain("demoNow() ? demoSide(i)");
  });

  it("dibuja la imagen del regalo de cada lado (icon) dentro del círculo", () => {
    const html = overlayPage("duelo", 7331, { id: "regalo-vs-regalo" });
    expect(html).toContain("sc.icon");
    expect(html).toContain(".avatar.gift");
  });

  it("se conecta al canal duelos con su id y trae los tres diseños", () => {
    const html = overlayPage("duelo", 7331, { id: "equipos" });
    expect(html).toContain('var KIND = "duelo";');
    expect(html).toContain('var DUEL_ID = "equipos";');
    expect(html).toContain('channel: "duelos"');
    expect(OVERLAY_DESIGNS.duelo.map((d) => d.id)).toEqual(["barra", "versus", "marcador"]);
    for (const d of OVERLAY_DESIGNS.duelo) expect(html).toContain(`[data-design="${d.id}"]`);
  });

  it("la vista previa activa el modo demo y marca la página como lista", () => {
    expect(overlayPage("duelo", 7331, { id: "top", demo: true })).toContain("var DEMO_MODE = true;");
    expect(overlayPage("duelo", 7331, { id: "top" })).toContain("var DEMO_MODE = false;");
    expect(overlayPage("duelo", 7331)).toContain('setAttribute("data-ready", "1")');
  });

  it("dibuja los dos lados, la barra y marca a quien va ganando", () => {
    const html = overlayPage("duelo", 7331, { id: "top" });
    for (const id of ["nameA", "nameB", "scoreA", "scoreB", "fill"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("data-lead");
    expect(html).toContain("@keyframes duPop");
  });
});

describe("overlay de tops", () => {
  it("se conecta al canal tops con su id y trae los dos diseños", () => {
    const html = overlayPage("top", 7331, { id: "likes" });
    expect(html).toContain('var KIND = "top";');
    expect(html).toContain('var TOP_ID = "likes";');
    expect(html).toContain('channel: "tops"');
    expect(OVERLAY_DESIGNS.top.map((d) => d.id)).toEqual(["lista", "podio"]);
    for (const d of OVERLAY_DESIGNS.top) expect(html).toContain(`[data-design="${d.id}"]`);
  });

  it("la vista previa de la app activa el ejemplo", () => {
    expect(overlayPage("top", 7331, { id: "likes", demo: true })).toContain("var DEMO_MODE = true;");
    expect(overlayPage("top", 7331, { id: "likes" })).toContain("var DEMO_MODE = false;");
  });
});

describe("overlay agente", () => {
  it("la página pide el canal agente y trae la barra de la cola", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain('channel: "agente"');
    expect(html).toContain('id="agqueue"');
    expect(html).toContain("Los regalos dan prioridad");
  });
});

describe("overlay agente: trivia", () => {
  it("trae la tarjeta de trivia y lee el estado de trivia del mensaje (no el de la cola)", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain('id="tvcard"');
    expect(html).toContain("tvState = DEMO ? null : m.payload.trivia;");
    expect(html).toContain("Escribe ");
  });
});

describe("overlay agente: avisos", () => {
  it("trae el aviso periódico y lo lee en voz alta", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain('id="agtip"');
    expect(html).toContain("speakText(tip.id, tip.text);");
  });
});

describe("overlay agente: partes sueltas", () => {
  it("el id de la ruta elige la parte (cola / respuesta) y vacío es todo junto", () => {
    expect(overlayPage("agente", 7331, { id: "cola" })).toContain('var AGENT_PART = "cola";');
    expect(overlayPage("agente", 7331, { id: "respuesta" })).toContain('var AGENT_PART = "respuesta";');
    expect(overlayPage("agente", 7331)).toContain('var AGENT_PART = "";');
  });

  it("solo la parte de respuestas habla (la de cola no, para no duplicar la voz)", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain('PART === "cola"');
    expect(html).toContain('.ag[data-part="respuesta"] .bar { display: none; }');
    expect(html).toContain('.ag[data-part="cola"] .card');
  });
});

describe("overlay agente: voz", () => {
  it("la vista previa de la app va sin voz (mute) y el overlay del stream habla", () => {
    expect(overlayPage("agente", 7331, { mute: true })).toContain("var MUTE_MODE = true;");
    expect(overlayPage("agente", 7331)).toContain("var MUTE_MODE = false;");
    expect(overlayPage("agente", 7331)).toContain("DEMO || MUTE_MODE ||");
  });
});

describe("overlay agente: personaje 3D", () => {
  const scriptOf = (html: string): string => {
    const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    return all[all.length - 1] ?? "";
  };

  it("el script de la página es JavaScript válido (la vista previa y el stream usan el mismo)", () => {
    const html = overlayPage("agente", 7331, { id: "personaje" });
    const js = scriptOf(html);
    expect(js.length).toBeGreaterThan(5000);
    expect(() => new Function(js)).not.toThrow();
  });

  it("lleva el puerto del sidecar y el modo demo solo cuando se pide", () => {
    expect(overlayPage("agente", 7331, { id: "personaje" })).toContain("var WS_PORT = 7331;");
    expect(overlayPage("agente", 7331, { id: "personaje" })).toContain("var DEMO_MODE = false;");
    expect(overlayPage("agente", 7331, { id: "personaje", demo: true })).toContain("var DEMO_MODE = true;");
  });

  it("la vista previa (mute) usa un recuadro fijo; el overlay real llena la fuente", () => {
    expect(overlayPage("agente", 7331, { id: "personaje", mute: true })).toContain('<div id="root" data-fixed="1">');
    expect(overlayPage("agente", 7331, { id: "personaje" })).toContain('<div id="root">');
  });

  it("el overlay del agente trae el diagnóstico de la voz (?debug=1)", () => {
    const html = overlayPage("agente", 7331);
    expect(html).toContain('id="agdbg"');
    expect(html).toContain('q.get("debug") === "1"');
  });

  it("no cambia las otras partes del agente", () => {
    expect(overlayPage("agente", 7331, { id: "cola" })).not.toContain("three.min.js");
    expect(overlayPage("agente", 7331)).not.toContain("three.min.js");
  });

  it("la config trae el personaje con sus valores de fábrica y rechaza colores mal escritos", () => {
    const c = AgentConfigSchema.parse({});
    expect(c.character).toEqual({ scarfColor: "#ffc94d", hairColor: "#3a3f9e", background: "transparent", floor: true });
    expect(AgentConfigSchema.safeParse({ character: { scarfColor: "amarillo" } }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ character: { background: "chroma" } }).success).toBe(true);
  });
});
