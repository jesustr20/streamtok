import { overlayPage } from "@streamtok/shared";
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
