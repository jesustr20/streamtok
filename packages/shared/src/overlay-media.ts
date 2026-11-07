import { MEDIA_IMAGE_DEFAULT_SECONDS } from "./media.js";

/**
 * Página de la «pantalla» de medios (`/overlay/pantalla/<n>`, ADR 0022): muestra las
 * imágenes, GIF y videos que mandan las Acciones. Fondo transparente. Se pega como fuente
 * web en TikTok LIVE Studio u OBS. Una cola por pantalla: si llega otro mientras se
 * muestra uno, espera su turno.
 *
 * El JavaScript va en una cadena: sin acentos graves ni "${" (lo comprueba la prueba de la página).
 */

const MEDIA_CSS = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  #stage img, #stage video { object-fit: contain; display: block; }
`;

const MEDIA_JS = `
(function () {
  var WS_PORT = __WS_PORT__;
  var SCREEN = __SCREEN__;
  var DEFAULT_IMG_SECONDS = __IMG_SECONDS__;
  var stage = document.getElementById("stage");
  var queue = [], busy = false, retry = 0;

  function srcOf(m) {
    if (m.source === "web") return m.url;
    return location.origin + "/media/" + encodeURIComponent(m.file);
  }
  function isVideo(m) {
    var s = (m.source === "web" ? m.url.split("?")[0] : m.file).toLowerCase();
    return /[.](mp4|webm|mov|ogv)$/.test(s);
  }
  function next() {
    if (busy || !queue.length) return;
    busy = true;
    var m = queue.shift();
    var el = isVideo(m) ? document.createElement("video") : document.createElement("img");
    var pct = Math.max(10, Math.min(100, m.sizePct || 50));
    el.style.maxWidth = pct + "vw";
    el.style.maxHeight = pct + "vh";
    var timer = null;
    var done = function () {
      if (timer) clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
      busy = false;
      next();
    };
    if (el.tagName === "VIDEO") {
      el.playsInline = true;
      el.autoplay = true;
      el.volume = Math.max(0, Math.min(1, (m.volume == null ? 50 : m.volume) / 100));
      el.onended = done;
    }
    el.onerror = done;
    el.src = srcOf(m);
    stage.appendChild(el);
    if (el.tagName === "VIDEO") {
      var p = el.play();
      if (p && p.catch) p.catch(function () { el.muted = true; el.play().catch(done); });
      if (m.durationSec > 0) timer = setTimeout(done, m.durationSec * 1000);
    } else {
      timer = setTimeout(done, (m.durationSec > 0 ? m.durationSec : DEFAULT_IMG_SECONDS) * 1000);
    }
  }
  function connect() {
    var ws;
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { return setTimeout(connect, 1000); }
    ws.onopen = function () { retry = 0; };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel === "media" && m.payload && m.payload.kind === "show" && m.payload.screen === SCREEN) {
          queue.push(m.payload);
          next();
        }
      } catch (e) {}
    };
    ws.onclose = function () { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  document.documentElement.setAttribute("data-ready", "1");
  connect();
})();
`;

export function mediaScreenPage(wsPort: number, screen: number): string {
  const js = MEDIA_JS.replace("__WS_PORT__", String(Math.trunc(wsPort)))
    .replace("__SCREEN__", String(Math.trunc(screen)))
    .replace("__IMG_SECONDS__", String(MEDIA_IMAGE_DEFAULT_SECONDS));
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamTok pantalla ${Math.trunc(screen)}</title>
<style>${MEDIA_CSS}</style>
</head>
<body>
<div id="stage"></div>
<script>${js}</script>
</body></html>`;
}
