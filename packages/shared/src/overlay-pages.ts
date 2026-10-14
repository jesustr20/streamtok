import type { OverlayKind } from "./overlays.js";

/**
 * Páginas de los overlays (ADR 0011): HTML/CSS/JS autocontenido, sin
 * dependencias externas ni recursos remotos. La página se conecta por WebSocket
 * al sidecar, recibe el estado y la configuración, y dibuja. Cada diseño es un
 * bloque de CSS activado por `body[data-design="<id>"]`: cambiar de diseño no
 * toca la lógica. Fondo siempre transparente (se pega sobre el juego).
 *
 * Vive en `shared` para que la app dibuje la vista previa con el MISMO código
 * que se sirve al stream (sin depender de la red local).
 *
 * IMPORTANTE: el JavaScript va dentro de una plantilla de TypeScript; no usar
 * comillas invertidas ni `${` en él.
 */

const BASE_CSS = `
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--text, #fff); }
  #root { display: inline-block; padding: 8px; transform-origin: top left; transform: scale(var(--scale, 1)); }
  .hidden { display: none !important; }
`;

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

const TIMER_CSS = `
  @keyframes blink { 50% { opacity: .25; } }
  body.finished #time { color: var(--accent, #ff5252); animation: blink 1s steps(2) infinite; }
  body.paused #time { opacity: .7; }
  .label { display: none; }

  /* Dígitos grandes: cuadro oscuro con números gruesos */
  body[data-design="interactive"] .box { background: var(--bg, rgba(0,0,0,.72)); border-radius: 14px; padding: 6px 30px; }
  body[data-design="interactive"] #time { font: 800 120px/1.05 Consolas, "SF Mono", "Courier New", monospace; letter-spacing: 4px; }

  /* Compacto: pastilla translúcida */
  body[data-design="tikfinity"] .box { background: var(--bg, rgba(20,20,22,.55)); border-radius: 12px; padding: 4px 20px; }
  body[data-design="tikfinity"] #time { font: 600 56px/1.15 "Segoe UI", system-ui, sans-serif; }

  /* StreamTok: tarjeta con borde de color y brillo */
  body[data-design="streamtok"] .box { display: flex; flex-direction: column; align-items: center; padding: 10px 30px 12px;
    border-radius: 18px; background: var(--bg, linear-gradient(160deg, rgba(18,18,28,.9), rgba(40,16,48,.9)));
    border: 2px solid var(--accent, #ff3d71); box-shadow: 0 0 22px rgba(255,61,113,.45); }
  body[data-design="streamtok"] .label { display: block; font: 700 14px/1 "Segoe UI", sans-serif; letter-spacing: 6px;
    text-transform: uppercase; color: var(--accent, #ff3d71); margin-bottom: 4px; }
  body[data-design="streamtok"] #time { font: 800 84px/1 "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
`;

const TIMER_BODY = `
  <div id="root"><div class="box"><span class="label">Tiempo</span><span id="time">00:00</span></div></div>
`;

/** Copia en JavaScript de `formatTimerMs` (overlays.ts) para la página del overlay. */
export const FORMAT_TIMER_JS = `
  function fmtTimer(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
    function two(n) { return n < 10 ? "0" + n : String(n); }
    return h > 0 ? two(h) + ":" + two(m) + ":" + two(sec) : two(m) + ":" + two(sec);
  }
`;

const TIMER_JS = `
  var timeEl = document.getElementById("time");
  ${FORMAT_TIMER_JS}
  function remaining() {
    if (!state) return 0;
    var t = state.timer;
    return t.status === "running" && t.endsAt ? Math.max(0, t.endsAt - (Date.now() + offset)) : t.remainingMs;
  }
  function render() {
    if (!state) return;
    timeEl.textContent = fmtTimer(remaining());
    document.body.classList.toggle("finished", state.timer.status === "finished");
    document.body.classList.toggle("paused", state.timer.status === "paused");
  }
  setInterval(render, 200);
`;

// ---------------------------------------------------------------------------
// Wins
// ---------------------------------------------------------------------------

const WINS_CSS = `
  @keyframes pulse { 0% { transform: scale(1); } 40% { transform: scale(1.12); } 100% { transform: scale(1); } }
  .pulse .count { animation: pulse .6s ease-out; }
  .title, .bar { display: none; }

  /* Trofeo: pastilla negra con el conteo en casillas */
  body[data-design="interactive"] .box { display: inline-flex; align-items: center; gap: 18px; background: var(--bg, #000);
    border-radius: 30px; padding: 14px 28px; }
  body[data-design="interactive"] .trophy { font-size: 80px; line-height: 1; }
  body[data-design="interactive"] .word { font: 800 96px/1 "Segoe UI", system-ui, sans-serif; }
  body[data-design="interactive"] .count { display: inline-flex; align-items: center; gap: 8px; }
  body[data-design="interactive"] .count b { display: inline-block; background: #1c1c1c; border-radius: 14px; padding: 0 16px;
    font: 800 84px/1.15 "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  body[data-design="interactive"] .count i { font-style: normal; font: 800 84px/1 "Segoe UI", sans-serif; }

  /* StreamTok: tarjeta con título y barra de progreso */
  body[data-design="streamtok"] .box { display: flex; align-items: baseline; gap: 14px; padding: 10px 26px 6px;
    background: var(--bg, linear-gradient(160deg, rgba(18,18,28,.9), rgba(40,16,48,.9)));
    border: 2px solid var(--accent, #ff3d71); border-bottom: 0; border-radius: 18px 18px 0 0; }
  body[data-design="streamtok"] .trophy { font-size: 34px; }
  body[data-design="streamtok"] .word { display: none; }
  body[data-design="streamtok"] .title { display: block; font: 700 22px/1 "Segoe UI", sans-serif; letter-spacing: 3px;
    text-transform: uppercase; color: var(--accent, #ff3d71); }
  body[data-design="streamtok"] .count { margin-left: auto; font: 800 64px/1 "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  body[data-design="streamtok"] .count i { font-style: normal; opacity: .6; margin: 0 6px; }
  body[data-design="streamtok"] .bar { display: block; height: 12px; border: 2px solid var(--accent, #ff3d71); border-top: 0;
    border-radius: 0 0 18px 18px; background: rgba(0,0,0,.6); overflow: hidden; }
  body[data-design="streamtok"] #fill { height: 100%; width: 0; background: var(--accent, #ff3d71); }
  body.ready[data-design="streamtok"] #fill { transition: width .4s ease; }
`;

const WINS_BODY = `
  <div id="root">
    <div class="box">
      <span class="trophy">&#127942;</span>
      <span class="word">Win</span>
      <span class="title" id="title"></span>
      <span class="count"><b id="count">0</b><i>/</i><b id="goal">0</b></span>
    </div>
    <div class="bar"><div id="fill"></div></div>
  </div>
`;

const WINS_JS = `
  var countEl = document.getElementById("count"), goalEl = document.getElementById("goal");
  var titleEl = document.getElementById("title"), fillEl = document.getElementById("fill");
  var lastCount = null;
  function render() {
    if (!state) return;
    var w = state.wins;
    countEl.textContent = w.count;
    goalEl.textContent = w.goal;
    titleEl.textContent = w.title;
    fillEl.style.width = (w.goal > 0 ? Math.min(100, (w.count / w.goal) * 100) : 0) + "%";
    if (lastCount !== null && w.count > lastCount) {
      document.body.classList.remove("pulse");
      void document.body.offsetWidth;
      document.body.classList.add("pulse");
    }
    lastCount = w.count;
    // La barra anima los cambios, pero no el primer dibujo.
    setTimeout(function () { document.body.classList.add("ready"); }, 50);
  }
`;

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

/** JavaScript común: conexión al sidecar con reintentos, estado, estilo y diseño. */
const COMMON_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var state = null, config = null, offset = 0, retry = 0, ws = null;

  function applyStyle() {
    if (!config) return;
    var style = KIND === "timer" ? config.timerStyle : config.winsStyle;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--accent": style.accentColor, "--bg": style.backgroundColor };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "overlays", payload: { kind: "get-state" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel === "overlays" && m.payload && m.payload.kind === "state") {
          state = m.payload.state;
          config = m.payload.config;
          offset = state.serverNow - Date.now();
          applyStyle();
          render();
        }
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  document.body.setAttribute("data-design", designOverride || "interactive");
  connect();
`;

/** Texto como literal JS seguro dentro de un <script> (escapa `<` para que no cierre la etiqueta). */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface OverlayPageOptions {
  /** Diseño forzado (vista previa dentro de la app, donde no hay `?design=`). */
  design?: string;
}

export function overlayPage(kind: OverlayKind, wsPort: number, opts: OverlayPageOptions = {}): string {
  const css = kind === "timer" ? TIMER_CSS : WINS_CSS;
  const body = kind === "timer" ? TIMER_BODY : WINS_BODY;
  const kindJs = kind === "timer" ? TIMER_JS : WINS_JS;
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamTok overlay ${kind}</title>
<style>${BASE_CSS}${css}</style>
</head>
<body data-design="interactive">
${body}
<script>
(function () {
  var KIND = ${JSON.stringify(kind)};
  var WS_PORT = ${Math.trunc(wsPort)};
  var DESIGN_OVERRIDE = ${jsString(opts.design ?? "")};
  // Funciones de dibujo de este overlay (definen render()).
  ${kindJs}
  // Conexión, estado y estilo comunes.
  ${COMMON_JS}
})();
</script>
</body></html>`;
}
