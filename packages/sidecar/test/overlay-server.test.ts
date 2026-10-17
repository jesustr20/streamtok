import { afterEach, describe, expect, it } from "vitest";
import { OVERLAY_DESIGNS } from "@streamtok/shared";
import { OverlayHttpServer } from "../src/overlay-server.js";

let server: OverlayHttpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(wsPort = 7331) {
  server = new OverlayHttpServer({ port: 0, wsPort });
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

describe("OverlayHttpServer", () => {
  it("sirve /overlay/timer y /overlay/wins como HTML con las cabeceras de red privada", async () => {
    const base = await start(9999);
    for (const kind of ["timer", "wins"]) {
      const res = await fetch(`${base}/overlay/${kind}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-private-network")).toBe("true");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain("var WS_PORT = 9999;");
      expect(html).toContain(`var KIND = "${kind}";`);
    }
  });

  it("incluye todos los diseños de cada tipo", async () => {
    const base = await start();
    for (const kind of ["timer", "wins"] as const) {
      const html = await (await fetch(`${base}/overlay/${kind}`)).text();
      for (const d of OVERLAY_DESIGNS[kind]) expect(html).toContain(`[data-design="${d.id}"]`);
    }
  });

  it("ignora parámetros extra (winName de LIVE Studio, design) y un id al final", async () => {
    const base = await start();
    expect((await fetch(`${base}/overlay/timer?winName=browser_abc`)).status).toBe(200);
    expect((await fetch(`${base}/overlay/timer?design=streamtok`)).status).toBe(200);
    expect((await fetch(`${base}/overlay/wins/2`)).status).toBe(200);
  });

  it("sirve /overlay/meta/<id> con el id de la instancia y los diseños de metas", async () => {
    const base = await start();
    const html = await (await fetch(`${base}/overlay/meta/mis-likes`)).text();
    expect(html).toContain('var KIND = "meta";');
    expect(html).toContain('var GOAL_ID = "mis-likes";');
    for (const d of OVERLAY_DESIGNS.meta) expect(html).toContain(`[data-design="${d.id}"]`);
    expect(await (await fetch(`${base}/overlay/meta`)).text()).toContain('var GOAL_ID = "";');
    // un id con comillas no rompe el script
    const evil = await (await fetch(`${base}/overlay/meta/${encodeURIComponent('"</script>')}`)).text();
    expect(evil).not.toContain('</script><');
    expect(evil.match(/<\/script>/g)).toHaveLength(1);
  });

  it("responde 404 a rutas desconocidas, también con las cabeceras CORS", async () => {
    const base = await start();
    for (const path of ["/", "/overlay", "/overlay/otro", "/nada"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("contesta el preflight OPTIONS con 204 y el permiso de red privada", async () => {
    const base = await start();
    const res = await fetch(`${base}/overlay/timer`, {
      method: "OPTIONS",
      headers: { Origin: "https://x.test", "Access-Control-Request-Private-Network": "true" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-private-network")).toBe("true");
  });

  it("rechaza métodos que no son GET/HEAD/OPTIONS", async () => {
    const base = await start();
    expect((await fetch(`${base}/overlay/timer`, { method: "POST" })).status).toBe(405);
  });

  it("solo escucha en loopback", async () => {
    await start();
    expect(server!.address()).toBe("127.0.0.1");
  });

  it("sirve /overlay/nivel/<id> con su id", async () => {
    const base = await start(9999);
    const html = await (await fetch(`${base}/overlay/nivel/comunidad`)).text();
    expect(html).toContain('var KIND = "nivel";');
    expect(html).toContain('var ALERT_ID = "comunidad";');
  });
});
