import { FORMAT_TIMER_JS, RATE_TEXT_JS, TimerConfigSchema, formatTimerMs, overlayPage, timerRateText } from "@streamtok/shared";
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
