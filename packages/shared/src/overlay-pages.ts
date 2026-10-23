import { PICK_VOICE_JS } from "./agente.js";
import { personajePage } from "./overlay-personaje.js";
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
  html { overflow: hidden; }
  html, body { margin: 0; background: transparent; }
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

  /* Título y equivalencia por moneda, sobre el temporizador */
  .head { text-align: center; line-height: 1.15; }
  .head b { display: block; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .head span { display: block; font-weight: 600; opacity: .85; }
  body.has-title .label { display: none !important; }
  body[data-design="interactive"] .head b { font-size: 34px; }
  body[data-design="interactive"] .head span { font-size: 26px; }
  body[data-design="tikfinity"] .head b { font-size: 20px; }
  body[data-design="tikfinity"] .head span { font-size: 15px; }
  body[data-design="streamtok"] .head b { font-size: 24px; color: var(--accent, #ff3d71); }
  body[data-design="streamtok"] .head span { font-size: 18px; }

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
  <div id="root"><div class="box"><span class="label">Tiempo</span><div class="head hidden" id="head"><b id="ttl"></b><span id="rate"></span></div><span id="time">00:00</span></div></div>
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

/** Copia en JavaScript de `timerRateText` (overlays.ts) para la página del overlay. */
export const RATE_TEXT_JS = `
  function rateText(t) {
    var mult = t.multiplier.active ? t.multiplier.value : 1;
    var seconds = Math.round(t.perType.coin * mult * 100) / 100;
    return seconds ? "1 coin = " + String(seconds) + " s" : "";
  }
`;

const TIMER_JS = `
  var timeEl = document.getElementById("time");
  var headEl = document.getElementById("head"), ttlEl = document.getElementById("ttl"), rateEl = document.getElementById("rate");
  ${FORMAT_TIMER_JS}
  ${RATE_TEXT_JS}
  function remaining() {
    if (!state) return 0;
    var t = state.timer;
    return t.status === "running" && t.endsAt ? Math.max(0, t.endsAt - (Date.now() + offset)) : t.remainingMs;
  }
  function render() {
    if (!state) return;
    timeEl.textContent = fmtTimer(remaining());
    var title = config && config.timer.title ? config.timer.title : "";
    var rate = config && config.timer.showRate ? rateText(config.timer) : "";
    ttlEl.textContent = title;
    rateEl.textContent = rate;
    ttlEl.classList.toggle("hidden", !title);
    rateEl.classList.toggle("hidden", !rate);
    headEl.classList.toggle("hidden", !title && !rate);
    document.body.classList.toggle("has-title", !!title);
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
    fillEl.style.width = (w.goal > 0 ? Math.max(0, Math.min(100, (w.count / w.goal) * 100)) : 0) + "%";
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
// Meta (ADR 0012): una instancia por id, canal WS "goals"
// ---------------------------------------------------------------------------

const META_CSS = `
  @keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes swap { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .pulse .box { animation: pop .5s ease-out; }
  .swap .box { animation: swap .35s ease-out; }
  .box { background: var(--bg, linear-gradient(160deg, rgba(18,18,28,.9), rgba(40,16,48,.9))); border: 2px solid var(--accent, #ff3d71);
    border-radius: 18px; padding: 12px 22px 14px; min-width: 360px; box-sizing: border-box; }
  .ttl { font: 700 22px/1.1 "Segoe UI", sans-serif; letter-spacing: 3px; text-transform: uppercase; color: var(--accent, #ff3d71); }
  .nums { font: 800 44px/1.1 "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums; }
  .nums i { font-style: normal; opacity: .55; margin: 0 6px; }
  .left, .ring, .ico, .pill { display: none; }
  .track { height: 16px; border-radius: 10px; background: rgba(0,0,0,.55); overflow: hidden; margin-top: 8px; }
  #fill, #pfill { height: 100%; width: 0; background: var(--accent, #ff3d71); }
  body.ready #fill, body.ready #pfill { transition: width .4s ease; }
  .done .ttl::after { content: " \\2714"; }

  /* Pastilla con icono: icono a la izquierda y barra ancha con el texto dentro */
  body[data-design="interactive"] .box { display: flex; align-items: center; gap: 14px; background: none; border: 0; padding: 0; min-width: 0; border-radius: 0; }
  body[data-design="interactive"] .ttl, body[data-design="interactive"] .nums, body[data-design="interactive"] .track { display: none; }
  body[data-design="interactive"] .ico { display: block; width: 64px; height: 64px; flex-shrink: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  body[data-design="interactive"] .ico svg { width: 100%; height: 100%; display: block; }
  body[data-design="interactive"] .pill { display: block; position: relative; width: 680px; height: 56px; border-radius: 28px; overflow: hidden;
    background: var(--bg, var(--accent, #2a9d8f)); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
  body[data-design="interactive"] #pfill { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(255,255,255,.32); }
  body[data-design="interactive"] #ptxt { position: relative; display: block; text-align: center; font: 700 26px/56px "Segoe UI", system-ui, sans-serif;
    color: var(--text, #fff); text-shadow: 0 1px 3px rgba(0,0,0,.45); white-space: nowrap; }

  /* Barra: tarjeta con la barra de progreso debajo */
  body[data-design="barra"] .track { display: block; }

  /* Círculo: anillo de progreso con el avance al centro */
  body[data-design="radial"] .box { display: flex; align-items: center; gap: 18px; min-width: 0; padding: 14px 24px 14px 14px; }
  body[data-design="radial"] .track { display: none; }
  body[data-design="radial"] .ring { display: flex; align-items: center; justify-content: center; width: 130px; height: 130px;
    border-radius: 50%; background: conic-gradient(var(--accent, #ff3d71) var(--p, 0%), rgba(255,255,255,.14) 0); flex-shrink: 0; }
  body[data-design="radial"] .ring b { display: flex; align-items: center; justify-content: center; width: 104px; height: 104px;
    border-radius: 50%; background: #11121a; font: 800 30px/1 "Segoe UI", sans-serif; }
  body[data-design="radial"] .nums { font-size: 32px; }

  /* Texto: solo lo que falta, sin barra */
  body[data-design="texto"] .box { background: var(--bg, rgba(0,0,0,.55)); border: 0; text-align: center; }
  body[data-design="texto"] .track, body[data-design="texto"] .nums { display: none; }
  body[data-design="texto"] .left { display: block; font: 800 56px/1.1 "Segoe UI", system-ui, sans-serif; }
`;

const META_BODY = `
  <div id="root">
    <div class="box">
      <span class="ico" id="ico"></span>
      <span class="ring"><b id="pct">0%</b></span>
      <div class="info">
        <div class="ttl" id="ttl"></div>
        <div class="nums"><span id="cur">0</span><i>/</i><span id="tgt">0</span></div>
        <div class="left" id="left"></div>
        <div class="track"><div id="fill"></div></div>
        <div class="pill"><div id="pfill"></div><span id="ptxt"></span></div>
      </div>
    </div>
  </div>
`;

/** Copia en JavaScript de `goalRemainingText` (metas.ts) para la página del overlay. */
export const GOAL_REMAINING_JS = `
  function goalRemainingText(current, target, before, after) {
    var left = target - current;
    if (left <= 0) return "¡Meta cumplida!";
    return before || after ? (before || "") + String(left) + (after || "") : "Faltan " + String(left);
  }
`;

const META_JS = `
  var curEl = document.getElementById("cur"), tgtEl = document.getElementById("tgt"), ttlEl = document.getElementById("ttl");
  var fillEl = document.getElementById("fill"), pctEl = document.getElementById("pct"), leftEl = document.getElementById("left");
  var pfillEl = document.getElementById("pfill"), ptxtEl = document.getElementById("ptxt"), icoEl = document.getElementById("ico");
  var ringEl = document.querySelector(".ring");
  var lastCur = null;
  var UNITS = { coins: "Monedas", gifts: "Regalos", likes: "Likes", follows: "Seguidores", shares: "Compartidos", subscribes: "Super Fans", comments: "Comentarios", viewers: "Espectadores" };
  var ICONS = {
    likes: '<svg viewBox="0 0 24 24"><path fill="#ff4d6d" d="M12 21C5 16.500 2 12.500 2 8.500 2 5.500 4.300 3.500 7 3.500c2 0 3.600 1 5 3 1.400-2 3-3 5-3 2.700 0 5 2 5 5 0 4-3 8-10 12.500z"/></svg>',
    follows: '<svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4" fill="#fff"/><path fill="#fff" d="M2 21c0-4.400 3.600-7 8-7s8 2.600 8 7z"/><path stroke="#fff" stroke-width="2.400" stroke-linecap="round" d="M20 5v6M17 8h6"/></svg>',
    shares: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M14 3l9 8-9 8v-5C8 14 4.500 15.500 1.500 20 2.500 13 6 9 14 8.200z"/></svg>',
    coins: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.500" fill="#f5b82e"/><circle cx="12" cy="12" r="7.500" fill="none" stroke="#c98a00" stroke-width="1.800"/><path fill="#c98a00" d="M12.800 6.500v1.200c1.200.2 2 .9 2.100 2h-1.700c0-.4-.5-.8-1.200-.8-.8 0-1.200.3-1.200.8 0 .5.400.7 1.600 1 1.700.4 2.700 1 2.700 2.500 0 1.200-.9 2-2.300 2.200v1.200h-1.600v-1.200c-1.500-.2-2.400-1-2.500-2.300h1.700c.1.600.6 1 1.500 1 .8 0 1.300-.3 1.300-.8 0-.5-.4-.7-1.700-1-1.600-.4-2.600-1-2.600-2.400 0-1.100.9-1.900 2.200-2.100V6.500z"/></svg>',
    subscribes: '<svg viewBox="0 0 24 24"><path fill="#ffc83d" d="M12 1.500l3.200 6.800 7.300.9-5.400 5 1.400 7.300L12 17.900 5.500 21.500l1.400-7.300-5.400-5 7.300-.9z"/></svg>',
    gifts: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="12" rx="1.500" fill="#ff6b8b"/><rect x="2" y="6" width="20" height="4.500" rx="1.200" fill="#ff8fa8"/><rect x="10.800" y="6" width="2.400" height="15" fill="#fff"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M12 6C9 6 7.500 2.500 9.500 2.500S12 5 12 6c0-1 1.500-3.500 2.500-3.500S15 6 12 6z"/></svg>',
    viewers: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M12 5C6.500 5 2.400 9 1 12c1.400 3 5.500 7 11 7s9.600-4 11-7c-1.400-3-5.500-7-11-7z"/><circle cx="12" cy="12" r="4.500" fill="#2b2f3a"/><circle cx="12" cy="12" r="2" fill="#fff"/></svg>',
    comments: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>'
  };
  ${GOAL_REMAINING_JS}
  function render() {
    if (!state) return;
    var p = state.target > 0 ? Math.max(0, Math.min(100, (state.current / state.target) * 100)) : 0;
    curEl.textContent = state.current;
    tgtEl.textContent = state.target;
    ttlEl.textContent = config.title || "";
    ttlEl.classList.toggle("hidden", !config.title);
    leftEl.textContent = goalRemainingText(state.current, state.target, config.textBefore, config.textAfter);
    fillEl.style.width = p + "%";
    pfillEl.style.width = p + "%";
    var unit = UNITS[config.metric] || "";
    var left = state.target - state.current;
    ptxtEl.textContent = (config.title ? config.title + " - " : "") + (config.countdown
      ? (left > 0 ? "Quedan " + left + " " + unit : "¡Meta cumplida!")
      : Math.floor(p) + "% " + unit);
    icoEl.innerHTML = ICONS[config.metric] || "";
    pctEl.textContent = Math.floor(p) + "%";
    ringEl.style.setProperty("--p", p + "%");
    document.body.classList.toggle("done", state.current >= state.target);
    if (lastCur !== null && state.current > lastCur) {
      document.body.classList.remove("pulse");
      void document.body.offsetWidth;
      document.body.classList.add("pulse");
    }
    lastCur = state.current;
    setTimeout(function () { document.body.classList.add("ready"); }, 50);
  }
`;

/**
 * Conexión de una Meta: pide TODAS al canal "goals" y se queda con la suya (o la primera
 * si no hay id). Con el id reservado "rotativa" va mostrando, una a una, las que tienen `rotate`.
 */
const META_COMMON_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var state = null, config = null, retry = 0, ws = null;
  var allGoals = [], rotIdx = 0, shownId = null;
  var ROTATION_ID = "rotativa", ROTATION_MS = 6000;

  function applyStyle() {
    var style = config.style;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--accent": style.accentColor, "--bg": style.backgroundColor };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  function currentGoal() {
    if (GOAL_ID === ROTATION_ID) {
      var list = allGoals.filter(function (g) { return g.config.rotate; });
      return list.length ? list[rotIdx % list.length] : null;
    }
    for (var i = 0; i < allGoals.length; i++) {
      if (!GOAL_ID || allGoals[i].config.id === GOAL_ID) return allGoals[i];
    }
    return null;
  }

  function refresh() {
    var found = currentGoal();
    document.getElementById("root").classList.toggle("hidden", !found);
    if (!found) { state = null; return; }
    if (shownId !== found.config.id) {
      if (shownId !== null) {
        document.body.classList.remove("swap");
        void document.body.offsetWidth;
        document.body.classList.add("swap");
      }
      shownId = found.config.id;
      lastCur = null;
    }
    state = found.state;
    config = found.config;
    applyStyle();
    render();
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "goals", payload: { kind: "get-state" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel !== "goals" || !m.payload || m.payload.kind !== "state") return;
        allGoals = m.payload.goals;
        refresh();
        document.documentElement.setAttribute("data-ready", "1");
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  setInterval(function () { if (GOAL_ID === ROTATION_ID) { rotIdx++; refresh(); } }, ROTATION_MS);
  document.body.setAttribute("data-design", designOverride || "interactive");
  connect();
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
    // El temporizador tiene tamaño fijo (se agranda en LIVE Studio/OBS); solo Wins admite escala.
    root.setProperty("--scale", KIND === "timer" ? 1 : style.scale || 1);
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
          document.documentElement.setAttribute("data-ready", "1");
        }
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  document.body.setAttribute("data-design", designOverride || "interactive");
  connect();
`;


// ---------------------------------------------------------------------------
// Nivel / comunidad (ADR 0014): avisos "se unió a la comunidad" y "subió de nivel"
// ---------------------------------------------------------------------------

const NIVEL_CSS = `
  #root[data-kind="fanJoin"] { --kc: #ff4d8d; }
  #root[data-kind="fanLevelUp"] { --kc: #a66bff; }
  #root[data-kind="donorLevelUp"] { --kc: #ffc233; }
  .alert { --k: var(--accent, var(--kc, #a66bff)); }
  @keyframes alIn { from { opacity: 0; transform: translateX(-46px) scale(.95); } to { opacity: 1; transform: none; } }
  @keyframes alOut { to { opacity: 0; transform: translateY(-16px) scale(.97); } }
  @keyframes alPop { 0% { transform: scale(.3); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
  #root.in .alert { animation: alIn .55s cubic-bezier(.2, .9, .3, 1.15) both; }
  #root.out .alert { animation: alOut .45s ease-in both; }
  #root.in .lvl { animation: alPop .6s .25s cubic-bezier(.2, .9, .3, 1.3) both; }
  .avatar { position: relative; flex: none; width: 72px; height: 72px; border-radius: 50%; background: #2b2f3a; display: flex; align-items: center; justify-content: center; font: 800 32px/1 "Segoe UI", sans-serif; color: #fff; }
  .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
  .lvl { position: absolute; right: -8px; bottom: -6px; min-width: 30px; height: 30px; padding: 0 6px; box-sizing: border-box; border-radius: 15px; background: var(--k); color: #fff; font: 800 16px/26px "Segoe UI", sans-serif; font-style: normal; text-align: center; border: 2px solid rgba(0, 0, 0, .35); }
  .msg small { display: block; font: 800 13px/1.2 "Segoe UI", sans-serif; letter-spacing: 2px; color: var(--k); }
  .msg p { margin: 3px 0 0; max-width: 520px; font: 600 24px/1.2 "Segoe UI", sans-serif; }
  .msg p b { font-weight: 800; }

  body[data-design="interactive"] .alert { display: flex; align-items: center; gap: 18px; padding: 14px 32px 14px 16px; border-radius: 999px; background: var(--bg, linear-gradient(135deg, rgba(34, 22, 58, .96), rgba(14, 12, 26, .96))); border: 3px solid var(--k); box-shadow: 0 6px 24px rgba(0, 0, 0, .45); }

  body[data-design="tarjeta"] .alert { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 360px; padding: 22px 28px 24px; border-radius: 24px; text-align: center; background: var(--bg, linear-gradient(160deg, rgba(34, 22, 58, .96), rgba(14, 12, 26, .96))); border: 3px solid var(--k); box-shadow: 0 8px 28px rgba(0, 0, 0, .5); }
  body[data-design="tarjeta"] .avatar { width: 104px; height: 104px; font-size: 44px; box-shadow: 0 0 0 5px var(--k); }
  body[data-design="tarjeta"] .lvl { right: -6px; bottom: -4px; height: 36px; min-width: 36px; border-radius: 18px; font-size: 19px; line-height: 32px; }
  body[data-design="tarjeta"] .msg small { font-size: 17px; letter-spacing: 3px; }
  body[data-design="tarjeta"] .msg p { font-size: 22px; max-width: 300px; }

  body[data-design="texto"] .alert { display: block; padding: 4px 8px; text-shadow: 0 2px 8px rgba(0, 0, 0, .85); }
  body[data-design="texto"] .avatar { display: none; }
  body[data-design="texto"] .msg p { font-size: 30px; max-width: 700px; }

  /* Efectos: anillo, rayos, número grande y partículas (diseños Anillo y Celebración) */
  .ring, .rays, .big { display: none; }
  .fx { display: block; position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; z-index: 3; }
  .fx i { position: absolute; left: 0; top: 0; display: block; width: var(--s); height: var(--s); margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2); border-radius: 50%; background: var(--c); animation: alSpark var(--t) cubic-bezier(.1, .7, .3, 1) both; }
  .fx i.h { width: auto; height: auto; margin: 0; border-radius: 0; background: none; font: 400 var(--s)/1 "Segoe UI Symbol", "Segoe UI", sans-serif; color: var(--c); animation-name: alHeart; animation-timing-function: ease-out; }
  @keyframes alSpark { 0% { transform: translate(0, 0) scale(1); opacity: 0; } 12% { opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.25); opacity: 0; } }
  @keyframes alHeart { 0% { transform: translate(-50%, 0) scale(.3); opacity: 0; } 18% { opacity: 1; } 100% { transform: translate(calc(-50% + var(--dx)), var(--dy)) scale(1); opacity: 0; } }
  @keyframes alRing { to { stroke-dashoffset: 0; } }
  @keyframes alSpin { to { transform: rotate(360deg); } }
  @keyframes alBig { 0% { transform: scale(.3); opacity: 0; } 60% { transform: scale(1.18); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes alRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes alShine { from { background-position: 130% 0; } to { background-position: -30% 0; } }
  @keyframes alGlow { 0%, 100% { box-shadow: 0 6px 24px rgba(0, 0, 0, .45); } 50% { box-shadow: 0 0 34px var(--k), 0 6px 24px rgba(0, 0, 0, .45); } }
  .ring circle { fill: none; stroke: var(--k); stroke-width: 5; stroke-linecap: round; stroke-dasharray: 289; stroke-dashoffset: 289; }

  /* Anillo animado: el anillo se dibuja alrededor de la foto, giran rayos de luz y salta "NIVEL N" */
  body[data-design="anillo"] .alert { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 100px 80px 34px; min-width: 400px; text-align: center; isolation: isolate; }
  body[data-design="anillo"] .avatar { width: 120px; height: 120px; font-size: 50px; box-shadow: 0 0 34px var(--k); }
  body[data-design="anillo"] .ring { display: block; position: absolute; left: -16px; top: -16px; width: 152px; height: 152px; overflow: visible; transform: rotate(-90deg); }
  body[data-design="anillo"] .rays { display: block; position: absolute; left: 50%; top: 50%; width: 290px; height: 290px; margin: -145px 0 0 -145px; border-radius: 50%; z-index: -1; opacity: .4; background: repeating-conic-gradient(from 0deg, var(--k) 0 7deg, transparent 7deg 22deg); -webkit-mask: radial-gradient(circle, transparent 28%, #000 30%, transparent 68%); mask: radial-gradient(circle, transparent 28%, #000 30%, transparent 68%); animation: alSpin 9s linear infinite; }
  body[data-design="anillo"] .lvl { display: none; }
  body[data-design="anillo"] .big { display: block; margin-top: 8px; font: 900 54px/1.05 "Segoe UI", sans-serif; letter-spacing: 3px; text-transform: uppercase; color: #fff; text-shadow: 0 0 18px var(--k), 0 3px 10px rgba(0, 0, 0, .6); }
  body[data-design="anillo"] .msg small { display: none; }
  body[data-design="anillo"] .msg p { max-width: 460px; font-size: 25px; text-shadow: 0 2px 8px rgba(0, 0, 0, .8); }
  #root.in .ring circle { animation: alRing 1.1s .15s ease-out forwards; }
  #root.in .big { animation: alBig .75s .35s cubic-bezier(.2, .9, .3, 1.2) both; }
  body[data-design="anillo"] #root.in .msg { animation: alRise .6s .6s ease-out both; }
  body[data-design="anillo"] #root.in .alert { animation: none; }
  body[data-design="anillo"] #root.in .avatar { animation: alPop .7s cubic-bezier(.2, .9, .3, 1.3) both; }
  body[data-design="anillo"] #root.out .alert { animation: alOut .45s ease-in both; }

  /* Celebración: la pastilla brilla, late y estalla en confeti (o corazones al unirse) */
  body[data-design="celebracion"] #root { padding: 50px 50px; }
  body[data-design="celebracion"] .msg p { max-width: 580px; }
  body[data-design="celebracion"] .alert { display: flex; align-items: center; gap: 18px; padding: 14px 32px 14px 16px; border-radius: 999px; background-color: var(--bg, #1a1230); background-image: linear-gradient(110deg, transparent 38%, rgba(255, 255, 255, .22) 50%, transparent 62%); background-size: 260% 100%; background-position: 130% 0; border: 3px solid var(--k); box-shadow: 0 6px 24px rgba(0, 0, 0, .45); }
  body[data-design="celebracion"] #root.in .alert { animation: alIn .55s cubic-bezier(.2, .9, .3, 1.15) both, alShine 1.5s .5s ease-out both, alGlow 1.2s .4s ease-in-out 2; }
  body[data-design="celebracion"] .avatar { box-shadow: 0 0 0 4px var(--k); }
  body[data-design="celebracion"] .msg small { font-size: 14px; letter-spacing: 3px; }
`;

const NIVEL_BODY = `
  <div id="root" class="hidden"><div class="alert">
    <div class="avatar"><i class="rays"></i><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg><img id="av" class="hidden" referrerpolicy="no-referrer" alt=""><span id="ini"></span><i class="lvl" id="lvl"></i><div class="fx" id="fx"></div></div>
    <div class="big" id="big"></div>
    <div class="msg"><small id="head"></small><p id="text"></p></div>
  </div></div>
`;

/**
 * Avisos de comunidad y nivel. Pide la configuración al canal "alertas" y se queda con la de su id;
 * cada aviso que llega se muestra en cola, uno tras otro, durante `durationSec`. En la vista previa
 * de la app (`demo`) va enseñando avisos de ejemplo sin esperar al LIVE.
 */
const NIVEL_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var DEMO = DEMO_MODE || q.get("demo") === "1";
  var config = null, retry = 0, ws = null, queue = [], showing = false, demoIdx = 0, demoTimer = null;
  var rootEl = document.getElementById("root"), avEl = document.getElementById("av"), iniEl = document.getElementById("ini");
  var fxEl = document.getElementById("fx"), bigEl = document.getElementById("big"), countTimer = null;
  var lvlEl = document.getElementById("lvl"), headEl = document.getElementById("head"), textEl = document.getElementById("text");
  var HEADS = { fanJoin: "¡NUEVO MIEMBRO!", fanLevelUp: "¡SUBE DE NIVEL!", donorLevelUp: "¡NIVEL DE DONADOR!" };
  var DEMO_ALERTS = [
    { kind: "fanJoin", name: "Valentina", level: 1 },
    { kind: "fanLevelUp", name: "Carlos_92", previousLevel: 11, level: 12 },
    { kind: "donorLevelUp", name: "Mariana", previousLevel: 26, level: 27 }
  ];

  function applyStyle() {
    var style = config.style;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--accent": style.accentColor, "--bg": style.backgroundColor };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  // Escribe la frase poniendo el nombre y el nivel en negrita.
  function fill(el, template, name, level) {
    el.textContent = "";
    var rest = String(template), toks = ["{nombre}", "{nivel}"];
    while (rest.length) {
      var best = -1, tok = null;
      for (var i = 0; i < toks.length; i++) {
        var p = rest.indexOf(toks[i]);
        if (p !== -1 && (best === -1 || p < best)) { best = p; tok = toks[i]; }
      }
      if (best === -1) { el.appendChild(document.createTextNode(rest)); break; }
      if (best > 0) el.appendChild(document.createTextNode(rest.slice(0, best)));
      var b = document.createElement("b");
      b.textContent = tok === "{nombre}" ? name : (level === undefined ? "" : String(level));
      el.appendChild(b);
      rest = rest.slice(best + tok.length);
    }
  }

  // Partículas: chispas de colores (corazones al unirse) que salen de la foto.
  var SPARK_COLORS = ["#ffd166", "#ff4d8d", "#7c5cff", "#36d1dc", "#ffffff"];
  var HEART_COLORS = ["#ff4d8d", "#ff8fb1", "#ffffff"];
  function burst(kind) {
    fxEl.textContent = "";
    var design = document.body.getAttribute("data-design");
    if (design !== "anillo" && design !== "celebracion") return;
    var hearts = kind === "fanJoin", n = hearts ? 18 : 36;
    for (var i = 0; i < n; i++) {
      var el = document.createElement("i"), ang = Math.random() * Math.PI * 2, dist = 55 + Math.random() * 80;
      var cols = hearts ? HEART_COLORS : SPARK_COLORS;
      if (hearts) {
        el.className = "h";
        el.textContent = "\u2665";
        el.style.setProperty("--dx", ((Math.random() - 0.5) * 120).toFixed(0) + "px");
        el.style.setProperty("--dy", (-(40 + Math.random() * 50)).toFixed(0) + "px");
        el.style.setProperty("--s", (14 + Math.random() * 16).toFixed(0) + "px");
      } else {
        el.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(0) + "px");
        el.style.setProperty("--dy", (Math.sin(ang) * dist).toFixed(0) + "px");
        el.style.setProperty("--s", (6 + Math.random() * 8).toFixed(0) + "px");
      }
      el.style.setProperty("--c", cols[i % cols.length]);
      el.style.setProperty("--t", (0.9 + Math.random() * 0.7).toFixed(2) + "s");
      el.style.animationDelay = (0.25 + Math.random() * 0.35).toFixed(2) + "s";
      fxEl.appendChild(el);
    }
  }

  // El número sube de golpe en golpe (de 11 a 12, etc.) mientras entra el aviso.
  function countUp(from, to, apply) {
    if (countTimer) clearInterval(countTimer);
    if (from === undefined || to === undefined || to <= from) { apply(to); return; }
    var steps = Math.min(to - from, 18), i = 0;
    apply(from);
    setTimeout(function () {
      countTimer = setInterval(function () {
        i++;
        apply(Math.round(from + ((to - from) * i) / steps));
        if (i >= steps) clearInterval(countTimer);
      }, Math.max(45, Math.round(750 / steps)));
    }, 500);
  }

  function accepts(a) {
    if (!config || config.kinds.indexOf(a.kind) === -1) return false;
    return a.kind === "fanJoin" || a.level === undefined || a.level >= config.minLevel;
  }

  function show(a) {
    showing = true;
    var name = a.name || "Alguien";
    rootEl.setAttribute("data-kind", a.kind);
    headEl.textContent = HEADS[a.kind] || "";
    fill(textEl, config.texts[a.kind] || "", name, a.level);
    var isJoin = a.kind === "fanJoin" || a.level === undefined;
    if (isJoin) {
      lvlEl.textContent = "♥";
      bigEl.textContent = "¡BIENVENIDO!";
    } else {
      countUp(a.previousLevel, a.level, function (n) {
        lvlEl.textContent = String(n);
        bigEl.textContent = "NIVEL " + n;
      });
    }
    iniEl.textContent = name.trim().charAt(0).toUpperCase();
    if (a.avatarUrl) {
      avEl.onerror = function () { avEl.classList.add("hidden"); iniEl.classList.remove("hidden"); };
      avEl.src = a.avatarUrl;
      avEl.classList.remove("hidden");
      iniEl.classList.add("hidden");
    } else {
      avEl.removeAttribute("src");
      avEl.classList.add("hidden");
      iniEl.classList.remove("hidden");
    }
    rootEl.classList.remove("hidden", "out", "in");
    void rootEl.offsetWidth;
    rootEl.classList.add("in");
    burst(a.kind);
    if (DEMO) { showing = false; return; } // la vista previa deja el aviso a la vista
    setTimeout(function () {
      rootEl.classList.remove("in");
      rootEl.classList.add("out");
      setTimeout(function () { rootEl.classList.add("hidden"); showing = false; next(); }, 450);
    }, Math.max(2, config.durationSec || 6) * 1000);
  }

  function next() {
    if (showing || !config) return;
    var a = queue.shift();
    if (a) show(a);
  }

  function startDemo() {
    if (demoTimer) clearInterval(demoTimer);
    var tick = function () {
      var list = DEMO_ALERTS.filter(accepts);
      if (!list.length) { rootEl.classList.add("hidden"); return; }
      show(list[demoIdx++ % list.length]);
    };
    tick();
    demoTimer = setInterval(tick, 3500);
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "alertas", payload: { kind: "get-state" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel !== "alertas" || !m.payload) return;
        if (m.payload.kind === "state") {
          var found = null;
          for (var i = 0; i < m.payload.configs.length; i++) {
            if (!ALERT_ID || m.payload.configs[i].id === ALERT_ID) { found = m.payload.configs[i]; break; }
          }
          config = found;
          if (config) {
            applyStyle();
            if (DEMO) startDemo();
          }
          document.documentElement.setAttribute("data-ready", "1");
        } else if (m.payload.kind === "alert" && !DEMO && accepts(m.payload.alert)) {
          if (queue.length < 20) queue.push(m.payload.alert);
          next();
        }
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  document.body.setAttribute("data-design", designOverride || "interactive");
  connect();
`;

// ---------------------------------------------------------------------------
// Duelos (ADR 0015): dos lados que compiten (Regalo vs Regalo, Azul vs Rojo, Top 1 vs Top 2)
// ---------------------------------------------------------------------------

const DUELO_CSS = `
  .duel { position: relative; }
  .title { grid-column: 1 / -1; text-align: center; font: 800 20px/1.1 "Segoe UI", sans-serif; letter-spacing: 5px; text-transform: uppercase; text-shadow: 0 2px 10px rgba(0, 0, 0, .8); }
  .side { --c: var(--ca, #ff3d71); min-width: 0; }
  .side.b { --c: var(--cb, #3da5ff); }
  .who { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .avatar { position: relative; flex: none; box-sizing: border-box; border-radius: 50%; overflow: hidden; background: #2b2f3a; border: 3px solid var(--c); display: flex; align-items: center; justify-content: center; font: 800 28px/1 "Segoe UI", sans-serif; color: #fff; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .names { min-width: 0; }
  .names b, .names small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); }
  .names b { font-weight: 800; }
  .names small { min-height: 1.3em; font-weight: 700; letter-spacing: 1px; opacity: .85; }
  .score, .barScore { font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 2px 10px rgba(0, 0, 0, .6); }
  .vs { font: italic 900 30px/1 "Segoe UI", sans-serif; text-align: center; text-shadow: 0 2px 10px rgba(0, 0, 0, .7); }
  .bar { display: none; position: relative; grid-column: 1 / -1; overflow: hidden; background: var(--cb, #3da5ff); }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; background: var(--ca, #ff3d71); transition: width .7s cubic-bezier(.3, .8, .3, 1); }
  .barScore { display: none; }
  .pop { animation: duPop .4s ease-out; }
  @keyframes duPop { 0% { transform: scale(1); } 35% { transform: scale(1.28); } 100% { transform: scale(1); } }
  @keyframes duIn { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: none; } }
  #root.in .duel { animation: duIn .5s ease-out both; }
  .duel[data-lead="a"] .side.a .names b::before, .duel[data-lead="b"] .side.b .names b::before { content: "♛ "; color: #ffc233; }

  /* Barra de fuerza: caras arriba y una barra que se mueve hacia quien va ganando */
  body[data-design="barra"] .duel { width: 760px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
  body[data-design="barra"] .side.b .who { flex-direction: row-reverse; text-align: right; }
  .avatar.gift { background: rgba(255,255,255,.1); }
  .avatar.gift img { box-sizing: border-box; padding: 14%; object-fit: contain; }
  body[data-design="barra"] .avatar { width: 64px; height: 64px; }
  body[data-design="barra"] .names b { font-size: 26px; line-height: 1.2; }
  body[data-design="barra"] .names small { font-size: 13px; line-height: 1.3; }
  body[data-design="barra"] .vs, body[data-design="barra"] .score { display: none; }
  body[data-design="barra"] .bar { display: block; height: 56px; border-radius: 28px; border: 3px solid rgba(255, 255, 255, .22); box-shadow: 0 6px 20px rgba(0, 0, 0, .45); }
  body[data-design="barra"] .fill { box-shadow: 4px 0 0 rgba(255, 255, 255, .85); }
  body[data-design="barra"] .barScore { display: block; position: absolute; top: 0; line-height: 50px; font-size: 30px; z-index: 2; }
  body[data-design="barra"] .barScore.a { left: 22px; }
  body[data-design="barra"] .barScore.b { right: 22px; }

  /* Frente a frente: dos tarjetas grandes con foto; la que va ganando sube */
  body[data-design="versus"] .duel { width: 700px; padding-top: 12px; display: grid; grid-template-columns: 1fr 84px 1fr; gap: 10px 0; align-items: center; }
  body[data-design="versus"] .side { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; box-sizing: border-box; height: 262px; padding: 18px 12px 14px; border-radius: 26px; border: 3px solid var(--c); background: var(--bg, linear-gradient(160deg, rgba(24, 20, 40, .92), rgba(12, 10, 22, .92))); box-shadow: 0 8px 26px rgba(0, 0, 0, .5); transition: transform .4s, box-shadow .4s; }
  body[data-design="versus"] .who { flex-direction: column; gap: 8px; width: 100%; }
  body[data-design="versus"] .avatar { width: 112px; height: 112px; font-size: 48px; }
  body[data-design="versus"] .names { width: 100%; }
  body[data-design="versus"] .names b { font-size: 28px; line-height: 1.2; }
  body[data-design="versus"] .names small { font-size: 14px; }
  body[data-design="versus"] .score { font-size: 58px; line-height: 1; text-shadow: 0 0 18px var(--c), 0 2px 10px rgba(0, 0, 0, .6); }
  body[data-design="versus"] .duel[data-lead="a"] .side.a, body[data-design="versus"] .duel[data-lead="b"] .side.b { transform: translateY(-8px) scale(1.03); box-shadow: 0 0 34px var(--c), 0 8px 26px rgba(0, 0, 0, .5); }

  /* Marcador: dos bloques de color con el nombre y los puntos, y una barra fina debajo */
  body[data-design="marcador"] .duel { width: 560px; display: grid; grid-template-columns: 1fr 60px 1fr; gap: 8px 0; }
  body[data-design="marcador"] .title, body[data-design="marcador"] .avatar { display: none; }
  body[data-design="marcador"] .side { display: flex; flex-direction: column; justify-content: center; box-sizing: border-box; height: 92px; padding: 8px 20px; background: var(--c); box-shadow: 0 6px 20px rgba(0, 0, 0, .4); transition: filter .4s; }
  body[data-design="marcador"] .side.a { border-radius: 18px 0 0 18px; align-items: flex-start; }
  body[data-design="marcador"] .side.b { border-radius: 0 18px 18px 0; align-items: flex-end; text-align: right; }
  body[data-design="marcador"] .who { width: 100%; }
  body[data-design="marcador"] .names { width: 100%; }
  body[data-design="marcador"] .names b { font-size: 22px; line-height: 1.2; letter-spacing: 2px; text-transform: uppercase; }
  body[data-design="marcador"] .names small { font-size: 12px; line-height: 1.3; }
  body[data-design="marcador"] .score { font-size: 44px; line-height: 1.05; }
  body[data-design="marcador"] .vs { display: flex; align-items: center; justify-content: center; background: #0d0d14; font-size: 20px; }
  body[data-design="marcador"] .bar { display: block; height: 12px; border-radius: 6px; }
  body[data-design="marcador"] .duel[data-lead="a"] .side.b, body[data-design="marcador"] .duel[data-lead="b"] .side.a { filter: brightness(.75); }
`;

const DUELO_BODY = `
  <div id="root" class="hidden"><div class="duel" id="duel">
    <div class="title hidden" id="title"></div>
    <div class="side a"><div class="who"><div class="avatar"><img id="avA" class="hidden" referrerpolicy="no-referrer" alt=""><span id="iniA"></span></div><div class="names"><b id="nameA"></b><small id="subA"></small></div></div><div class="score" id="scoreA">0</div></div>
    <div class="vs">VS</div>
    <div class="side b"><div class="who"><div class="avatar"><img id="avB" class="hidden" referrerpolicy="no-referrer" alt=""><span id="iniB"></span></div><div class="names"><b id="nameB"></b><small id="subB"></small></div></div><div class="score" id="scoreB">0</div></div>
    <div class="bar"><div class="fill" id="fill"></div><span class="barScore a" id="barA">0</span><span class="barScore b" id="barB">0</span></div>
  </div></div>
`;

/**
 * Duelos. Pide la configuración y el marcador al canal "duelos" y se queda con los de su id. En la
 * vista previa de la app (`demo`) el marcador sube solo con nombres de ejemplo.
 */
const DUELO_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var DEMO = DEMO_MODE || q.get("demo") === "1";
  var config = null, state = null, retry = 0, ws = null, demoTimer = null, demoUnits = null, shown = false, last = [null, null];
  var DEMO_NAMES = ["Valentina", "Carlos_92"];
  var rootEl = document.getElementById("root"), duelEl = document.getElementById("duel"), titleEl = document.getElementById("title"), fillEl = document.getElementById("fill");
  var S = [];
  ["A", "B"].forEach(function (p) {
    S.push({ av: document.getElementById("av" + p), ini: document.getElementById("ini" + p), name: document.getElementById("name" + p), sub: document.getElementById("sub" + p), score: document.getElementById("score" + p), bar: document.getElementById("bar" + p), url: "" });
  });

  function applyStyle() {
    var style = config.style;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--bg": style.backgroundColor, "--ca": config.sides[0].color, "--cb": config.sides[1].color };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  function fmt(n) { try { return Number(n).toLocaleString("es"); } catch (e) { return String(n); } }

  // La vista previa de la app usa datos de ejemplo solo mientras el duelo está a cero; con puntos reales, muestra los reales.
  function demoNow() {
    if (!DEMO) return false;
    var real = state && state.sides;
    return !(real && ((real[0].score || 0) > 0 || (real[1].score || 0) > 0));
  }

  // Valor de cada unidad del ejemplo: con "monedas", lo que vale el regalo de ese lado; si no, 1.
  function unitOf(i) {
    var c = config && config.sides[i];
    return config && config.mode === "regalos" && config.metric === "coins" && c && c.cost > 0 ? c.cost : 1;
  }

  function isBig() { return unitOf(0) > 1 || unitOf(1) > 1; }
  function units() { if (!demoUnits) demoUnits = isBig() ? [6, 4] : [18, 11]; return demoUnits; }

  function demoSide(i) {
    return { score: units()[i] * unitOf(i), supporters: [{ name: DEMO_NAMES[i] }], members: Math.round(units()[i] / 3) + 1, name: DEMO_NAMES[i] };
  }

  // Lo que se dibuja en cada lado, según el modo del duelo.
  function sides() {
    var out = [];
    for (var i = 0; i < 2; i++) {
      var sc = config.sides[i];
      var st = demoNow() ? demoSide(i) : ((state && state.sides[i]) || { score: 0, supporters: [] });
      var mvp = st.supporters && st.supporters[0], name, sub = "", avatar, gift = false;
      if (config.mode === "top") {
        name = st.name || "\\u2014";
        sub = "TOP " + (i + 1);
        avatar = st.avatarUrl;
      } else {
        name = sc.name || (i ? "B" : "A");
        avatar = mvp && mvp.avatarUrl;
        if (config.mode === "equipos") sub = (st.members || 0) + ((st.members || 0) === 1 ? " persona" : " personas");
        else {
          // regalos: arriba, quien más aporta a este lado; debajo y más pequeño, el regalo. Sin aportes aún, el regalo va arriba.
          var label = sc.name || (sc.gifts && sc.gifts.join(" + ")) || name;
          if (sc.icon) { avatar = sc.icon; gift = true; }
          if (mvp && mvp.name) { name = mvp.name; sub = label; } else name = label;
        }
      }
      out.push({ name: name, sub: sub, avatar: avatar, gift: gift, score: st.score || 0 });
    }
    return out;
  }

  function setAvatar(s, v) {
    s.ini.textContent = v.name === "\\u2014" ? "?" : v.name.trim().charAt(0).toUpperCase();
    s.av.parentNode.classList.toggle("gift", !!v.gift);
    var url = v.avatar || "";
    if (url === s.url) return;
    s.url = url;
    if (url) {
      s.av.onerror = function () { s.av.classList.add("hidden"); s.ini.classList.remove("hidden"); };
      s.av.src = url;
      s.av.classList.remove("hidden");
      s.ini.classList.add("hidden");
    } else {
      s.av.removeAttribute("src");
      s.av.classList.add("hidden");
      s.ini.classList.remove("hidden");
    }
  }

  function pop(el) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  function render() {
    if (!config) return;
    var v = sides(), total = v[0].score + v[1].score;
    var pa = total > 0 ? Math.min(97, Math.max(3, (v[0].score * 100) / total)) : 50;
    fillEl.style.width = pa + "%";
    titleEl.textContent = config.title || "";
    if (config.title) titleEl.classList.remove("hidden"); else titleEl.classList.add("hidden");
    for (var i = 0; i < 2; i++) {
      S[i].name.textContent = v[i].name;
      S[i].sub.textContent = v[i].sub;
      S[i].score.textContent = fmt(v[i].score);
      S[i].bar.textContent = fmt(v[i].score);
      setAvatar(S[i], v[i]);
      if (last[i] !== null && last[i] !== v[i].score) { pop(S[i].score); pop(S[i].bar); }
      last[i] = v[i].score;
    }
    duelEl.setAttribute("data-lead", v[0].score === v[1].score ? "" : v[0].score > v[1].score ? "a" : "b");
    if (!shown) {
      shown = true;
      rootEl.classList.remove("hidden");
      rootEl.classList.add("in");
    }
  }

  function startDemo() {
    if (demoTimer) return;
    demoTimer = setInterval(function () {
      // cada paso del ejemplo es "llegaron N regalos": con monedas, suma N veces el valor del regalo
      var big = isBig(), u = units();
      u[Math.random() < 0.55 ? 0 : 1] += 1 + Math.floor(Math.random() * (big ? 3 : 6));
      if (u[0] + u[1] > (big ? 40 : 400)) demoUnits = null;
      render();
    }, 1100);
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "duelos", payload: { kind: "get-state" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel !== "duelos" || !m.payload || m.payload.kind !== "state") return;
        var found = null, i;
        for (i = 0; i < m.payload.configs.length; i++) {
          if (!DUEL_ID || m.payload.configs[i].id === DUEL_ID) { found = m.payload.configs[i]; break; }
        }
        config = found;
        state = null;
        if (found) {
          for (i = 0; i < m.payload.states.length; i++) if (m.payload.states[i].id === found.id) state = m.payload.states[i];
          applyStyle();
          render();
          if (DEMO) startDemo();
        }
        document.documentElement.setAttribute("data-ready", "1");
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  document.body.setAttribute("data-design", designOverride || "barra");
  connect();
`;

// ---------------------------------------------------------------------------
// Tops (ADR 0017): rankings de espectadores (Top Gifters, Likes, Comentarios, Compartidos)
// ---------------------------------------------------------------------------

const TOP_CSS = `
  .top { --gold: var(--accent, #ffc233); position: relative; }
  .head { display: flex; align-items: baseline; justify-content: center; gap: 10px; text-align: center; text-shadow: 0 2px 10px rgba(0, 0, 0, .8); }
  .head b { font: 800 18px/1.2 "Segoe UI", sans-serif; letter-spacing: 3px; text-transform: uppercase; }
  .head small { font: 700 12px/1.2 "Segoe UI", sans-serif; letter-spacing: 1px; opacity: .7; text-transform: uppercase; }
  .av { position: relative; flex: none; box-sizing: border-box; border-radius: 50%; overflow: hidden; background: #2b2f3a; display: flex; align-items: center; justify-content: center; font: 800 20px/1 "Segoe UI", sans-serif; color: #fff; }
  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av i { font-style: normal; }
  .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; text-shadow: 0 2px 8px rgba(0, 0, 0, .7); }
  .sc { font-weight: 900; font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 2px 10px rgba(0, 0, 0, .6); }
  .empty { opacity: .35; }
  .pop { animation: tpPop .4s ease-out; }
  @keyframes tpPop { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 100% { transform: scale(1); } }
  @keyframes tpIn { from { opacity: 0; transform: translateY(14px) scale(.97); } to { opacity: 1; transform: none; } }
  #root.in .top { animation: tpIn .5s ease-out both; }
  .r1 { --rc: #ffc233; } .r2 { --rc: #c5ccd6; } .r3 { --rc: #d98a4a; }

  /* Lista: tarjeta con los primeros puestos en filas de altura fija */
  body[data-design="lista"] .top { width: 420px; box-sizing: border-box; padding: 14px 14px 12px; border-radius: 20px; border: 2px solid var(--gold); background: var(--bg, linear-gradient(160deg, rgba(24, 20, 40, .92), rgba(12, 10, 22, .92))); box-shadow: 0 8px 26px rgba(0, 0, 0, .5); }
  body[data-design="lista"] .head { height: 30px; margin-bottom: 10px; }
  body[data-design="lista"] .podium { display: none; }
  body[data-design="lista"] .row { display: flex; align-items: center; gap: 10px; box-sizing: border-box; height: 48px; margin-bottom: 6px; padding: 0 12px 0 8px; border-radius: 14px; background: rgba(255, 255, 255, .07); }
  body[data-design="lista"] .row:last-child { margin-bottom: 0; }
  body[data-design="lista"] .rk { flex: none; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 900 15px/1 "Segoe UI", sans-serif; background: var(--rc, #4a4e5c); color: #1b1620; }
  body[data-design="lista"] .av { width: 36px; height: 36px; border: 2px solid var(--rc, rgba(255, 255, 255, .25)); }
  body[data-design="lista"] .nm { flex: 1; font-size: 18px; }
  body[data-design="lista"] .sc { font-size: 20px; color: var(--rc, #fff); }

  /* Podio: los tres primeros con foto grande sobre un pedestal */
  body[data-design="podio"] .top { width: 480px; box-sizing: border-box; padding: 14px 14px 0; border-radius: 20px; border: 2px solid var(--gold); background: var(--bg, linear-gradient(160deg, rgba(24, 20, 40, .92), rgba(12, 10, 22, .92))); box-shadow: 0 8px 26px rgba(0, 0, 0, .5); overflow: hidden; }
  body[data-design="podio"] .head { height: 30px; margin-bottom: 8px; }
  body[data-design="podio"] .list { display: none; }
  body[data-design="podio"] .podium { display: flex; align-items: flex-end; justify-content: center; gap: 12px; height: 262px; }
  body[data-design="podio"] .slot { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
  body[data-design="podio"] .slot .crown { height: 24px; font-size: 22px; line-height: 24px; color: var(--rc); text-shadow: 0 0 10px var(--rc); visibility: hidden; }
  body[data-design="podio"] .slot.r1 .crown { visibility: visible; }
  body[data-design="podio"] .slot .av { width: 64px; height: 64px; border: 3px solid var(--rc); font-size: 26px; margin-bottom: 6px; }
  body[data-design="podio"] .slot.r1 .av { width: 84px; height: 84px; font-size: 32px; }
  body[data-design="podio"] .slot .nm { width: 100%; font-size: 17px; line-height: 1.25; }
  body[data-design="podio"] .slot .sc { font-size: 20px; line-height: 1.2; color: var(--rc); margin-bottom: 8px; }
  body[data-design="podio"] .slot .ped { width: 100%; display: flex; align-items: flex-start; justify-content: center; box-sizing: border-box; padding-top: 8px; border-radius: 12px 12px 0 0; font: 900 30px/1 "Segoe UI", sans-serif; color: #1b1620; background: var(--rc); }
  body[data-design="podio"] .slot.r1 .ped { height: 96px; }
  body[data-design="podio"] .slot.r2 .ped { height: 70px; }
  body[data-design="podio"] .slot.r3 .ped { height: 50px; }
`;

const TOP_BODY = `
  <div id="root" class="hidden"><div class="top" id="top">
    <div class="head"><b id="title"></b><small id="sub"></small></div>
    <div class="list" id="list"></div>
    <div class="podium" id="podium"></div>
  </div></div>
`;

/**
 * Tops. Pide la configuración y el ranking al canal "tops" y se queda con los de su id. En la vista
 * previa de la app (`demo`) el ranking sube solo con nombres de ejemplo.
 */
const TOP_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var DEMO = DEMO_MODE || q.get("demo") === "1";
  var config = null, state = null, retry = 0, ws = null, demoTimer = null, shown = false;
  var METRIC_UNITS = { coins: "monedas", likes: "likes", comments: "comentarios", shares: "compartidos" };
  var DEMO_NAMES = ["Valentina", "Carlos_92", "Luna", "Diego", "Mia", "Joaquin", "Sofi", "Andres", "Cami", "Nico"];
  var demoScores = null;
  var rootEl = document.getElementById("root"), listEl = document.getElementById("list"), podEl = document.getElementById("podium");
  var titleEl = document.getElementById("title"), subEl = document.getElementById("sub");
  var rows = [], slots = [], built = 0, lastScores = [];

  function fmt(n) { try { return Number(n).toLocaleString("es"); } catch (e) { return String(n); } }
  function rankClass(i) { return i < 3 ? " r" + (i + 1) : ""; }

  function applyStyle() {
    var style = config.style;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--bg": style.backgroundColor, "--accent": style.accentColor };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  function avatarHtml() { return '<span class="av"><img class="hidden" referrerpolicy="no-referrer" alt=""><i></i></span>'; }

  // Las filas se crean una vez por cantidad de puestos (y los 3 huecos del podio una sola vez).
  function build(count) {
    var i, html = "";
    built = count;
    for (i = 0; i < count; i++) html += '<div class="row' + rankClass(i) + '"><span class="rk">' + (i + 1) + "</span>" + avatarHtml() + '<span class="nm"></span><span class="sc"></span></div>';
    listEl.innerHTML = html;
    rows = [].slice.call(listEl.children).map(function (el) { return pick(el); });
    var order = [1, 0, 2];
    html = "";
    for (i = 0; i < 3; i++) html += '<div class="slot r' + (order[i] + 1) + '"><div class="crown">&#9819;</div>' + avatarHtml() + '<div class="nm"></div><div class="sc"></div><div class="ped">' + (order[i] + 1) + "</div></div>";
    podEl.innerHTML = html;
    slots = [];
    [].slice.call(podEl.children).forEach(function (el, n) { var s = pick(el); slots[order[n]] = s; });
    lastScores = [];
  }

  function pick(el) {
    return { el: el, img: el.querySelector("img"), ini: el.querySelector("i"), nm: el.querySelector(".nm"), sc: el.querySelector(".sc"), url: "" };
  }

  function setAvatar(s, entry) {
    s.ini.textContent = entry ? entry.name.trim().charAt(0).toUpperCase() : "?";
    var url = (entry && entry.avatarUrl) || "";
    if (url === s.url) return;
    s.url = url;
    if (url) {
      s.img.onerror = function () { s.img.classList.add("hidden"); s.ini.classList.remove("hidden"); };
      s.img.src = url;
      s.img.classList.remove("hidden");
      s.ini.classList.add("hidden");
    } else {
      s.img.removeAttribute("src");
      s.img.classList.add("hidden");
      s.ini.classList.remove("hidden");
    }
  }

  function pop(el) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  function entries() {
    if (DEMO) {
      if (!demoScores) {
        var base = config.metric === "coins" ? 900 : config.metric === "likes" ? 400 : 60;
        demoScores = DEMO_NAMES.map(function (n, i) { return { name: n, score: Math.round(base * (1 - i * 0.09)) }; });
      }
      return demoScores.slice().sort(function (a, b) { return b.score - a.score; });
    }
    return (state && state.entries) || [];
  }

  function render() {
    if (!config) return;
    if (built !== config.count) build(config.count);
    var list = entries(), i;
    var def = { coins: "Top Gifters", likes: "Top Likes", comments: "Top Comentarios", shares: "Top Compartidos" };
    titleEl.textContent = config.title || def[config.metric] || "Top";
    subEl.textContent = (METRIC_UNITS[config.metric] || "") + " \\u00b7 " + (config.period === "day" ? "hoy" : "este LIVE");
    for (i = 0; i < built; i++) paint(rows[i], list[i], i);
    for (i = 0; i < 3; i++) paint(slots[i], list[i], i);
    if (!shown) {
      shown = true;
      rootEl.classList.remove("hidden");
      rootEl.classList.add("in");
    }
  }

  function paint(s, entry, i) {
    s.nm.textContent = entry ? entry.name : "\\u2014";
    s.sc.textContent = entry ? fmt(entry.score) : "";
    s.el.classList.toggle("empty", !entry);
    setAvatar(s, entry);
    var key = (s.el.className.indexOf("slot") >= 0 ? "p" : "l") + i, was = lastScores[key], now = entry ? entry.score : 0;
    if (was !== undefined && was !== now) pop(s.sc);
    lastScores[key] = now;
  }

  function startDemo() {
    if (demoTimer) return;
    demoTimer = setInterval(function () {
      if (!demoScores) return;
      var k = Math.floor(Math.random() * Math.min(5, demoScores.length));
      var step = config.metric === "coins" ? 20 + Math.floor(Math.random() * 90) : 1 + Math.floor(Math.random() * 9);
      demoScores[k].score += step;
      render();
    }, 1200);
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "tops", payload: { kind: "get-state" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel !== "tops" || !m.payload || m.payload.kind !== "state") return;
        var found = null, i;
        for (i = 0; i < m.payload.configs.length; i++) {
          if (!TOP_ID || m.payload.configs[i].id === TOP_ID) { found = m.payload.configs[i]; break; }
        }
        config = found;
        state = null;
        if (found) {
          for (i = 0; i < m.payload.states.length; i++) if (m.payload.states[i].id === found.id) state = m.payload.states[i];
          applyStyle();
          render();
          if (DEMO) startDemo();
        }
        document.documentElement.setAttribute("data-ready", "1");
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  document.body.setAttribute("data-design", designOverride || "lista");
  connect();
`;

const AGENTE_CSS = `
  .ag { --gold: var(--accent, #7c5cff); position: relative; width: 460px; box-sizing: border-box; }
  .ag .bar { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 10px; box-sizing: border-box; padding: 8px 14px; border-radius: 14px; background: var(--bg, rgba(14, 12, 28, .92)); border: 2px solid var(--gold); box-shadow: 0 6px 20px rgba(0, 0, 0, .45); font: 800 12px/1.2 "Segoe UI", sans-serif; letter-spacing: 1px; text-transform: uppercase; }
  .ag .bar b { color: var(--gold); letter-spacing: 2px; }
  .ag .bar .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 8px var(--gold); }
  .ag .bar .sep { opacity: .35; }
  .ag .bar .free.ready { color: #5be37d; }
  .ag .bar .hint { opacity: .65; }
  .ag .card { margin-top: 8px; box-sizing: border-box; padding: 12px 14px; border-radius: 16px; background: var(--bg, rgba(14, 12, 28, .92)); border: 2px solid rgba(255, 255, 255, .18); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
  .ag .who { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .av { position: relative; flex: none; box-sizing: border-box; width: 36px; height: 36px; border-radius: 50%; overflow: hidden; background: #2b2f3a; display: flex; align-items: center; justify-content: center; font: 800 16px/1 "Segoe UI", sans-serif; color: #fff; border: 2px solid var(--gold); }
  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av i { font-style: normal; }
  .ag .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 800 16px/1.2 "Segoe UI", sans-serif; }
  .ag .coins { flex: none; font: 900 13px/1 "Segoe UI", sans-serif; padding: 4px 8px; border-radius: 10px; background: #ffc233; color: #1b1620; }
  .ag .q { font: 600 15px/1.3 "Segoe UI", sans-serif; opacity: .8; margin-bottom: 8px; overflow-wrap: anywhere; }
  .ag .a { font: 700 18px/1.35 "Segoe UI", sans-serif; overflow-wrap: anywhere; min-height: 24px; }
  .ag .a .cur { display: inline-block; width: 8px; height: 1em; margin-left: 2px; vertical-align: -2px; background: var(--gold); animation: agBlink 1s steps(2) infinite; }
  .ag .stat { margin-top: 6px; box-sizing: border-box; padding: 6px 12px; border-radius: 12px; background: var(--bg, rgba(14, 12, 28, .92)); border: 1px solid rgba(255, 255, 255, .18); display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 10px; font: 700 13px/1.3 "Segoe UI", sans-serif; }
  .ag .stat .nxt { opacity: .7; }
  .ag .ntcs { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  .ag .ntcs:empty { display: none; }
  .ag .ntc { box-sizing: border-box; padding: 8px 12px; border-radius: 14px; background: var(--bg, rgba(14, 12, 28, .92)); border: 2px solid var(--gold); box-shadow: 0 6px 18px rgba(0, 0, 0, .45); font: 700 14px/1.35 "Segoe UI", sans-serif; overflow-wrap: anywhere; animation: agIn .35s ease-out both; }
  .ag .tip { margin-top: 8px; box-sizing: border-box; padding: 10px 14px; border-radius: 16px; background: var(--bg, rgba(14, 12, 28, .92)); border: 2px solid rgba(255, 255, 255, .18); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); font: 700 15px/1.4 "Segoe UI", sans-serif; overflow-wrap: anywhere; display: flex; gap: 10px; align-items: flex-start; animation: agIn .35s ease-out both; }
  .ag .tip b { flex: none; font-size: 18px; line-height: 1.2; }
  .ag .tv { margin-top: 8px; box-sizing: border-box; padding: 12px 14px; border-radius: 16px; background: var(--bg, rgba(14, 12, 28, .92)); border: 2px solid var(--gold); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
  .ag .tv .tvhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font: 900 12px/1 "Segoe UI", sans-serif; letter-spacing: 3px; color: var(--gold); text-transform: uppercase; }
  .ag .tv .tvhead span { font-size: 15px; letter-spacing: 0; color: var(--text, #fff); font-variant-numeric: tabular-nums; }
  .ag .tv .tvq { font: 800 17px/1.3 "Segoe UI", sans-serif; margin-bottom: 10px; overflow-wrap: anywhere; }
  .ag .tv .tvopt { display: flex; align-items: center; gap: 10px; box-sizing: border-box; padding: 6px 10px; margin-bottom: 6px; border-radius: 12px; background: rgba(255, 255, 255, .08); font: 700 15px/1.2 "Segoe UI", sans-serif; }
  .ag .tv .tvopt b { flex: none; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--gold); color: #1b1620; font-weight: 900; font-size: 13px; }
  .ag .tv .tvopt.ok { background: #1f9d55; }
  .ag .tv .tvopt.ok b { background: #fff; color: #1f9d55; }
  .ag .tv .tvopt.dim { opacity: .35; }
  .ag .tv .tvbar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .15); overflow: hidden; margin-top: 8px; }
  .ag .tv .tvbar i { display: block; height: 100%; width: 100%; background: var(--gold); transition: width .3s linear; }
  .ag .tv .tvfoot { margin-top: 8px; font: 800 14px/1.3 "Segoe UI", sans-serif; text-align: center; }
  .ag .tv .tvfoot.win { color: #ffc233; }
  @keyframes agBlink { 50% { opacity: 0; } }
  @keyframes agIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .ag .card.in { animation: agIn .35s ease-out both; }
  /* Partes sueltas: /overlay/agente/cola solo la barra; /overlay/agente/respuesta todo menos la barra. */
  .ag[data-part="cola"] .tip, .ag[data-part="cola"] .tv, .ag[data-part="cola"] .card, .ag[data-part="cola"] .ntcs { display: none !important; }
  .ag[data-part="respuesta"] .stat { display: none; }
  .ag[data-part="respuesta"] .bar { display: none; }
  .ag[data-part="respuesta"] .tip, .ag[data-part="respuesta"] .tv, .ag[data-part="respuesta"] .card { margin-top: 0; }
`;

const AGENTE_BODY = `
  <div id="root" class="hidden"><div class="ag" id="ag">
    <div class="bar"><span class="dot"></span><b id="agname"></b><span class="sep">|</span><span id="agqueue"></span><span class="sep">|</span><span class="free" id="agfree"></span><span class="sep">|</span><span class="hint">Los regalos dan prioridad</span></div>
    <div class="stat hidden" id="agstat"><span id="agstattext"></span><span class="nxt hidden" id="agnext"></span></div>
    <div class="ntcs" id="agnotices"></div>
    <div class="hidden" id="agdbg" style="position:fixed;left:0;bottom:0;right:0;padding:4px 8px;font:12px/1.35 monospace;color:#fff;background:rgba(0,0,0,.8);white-space:pre-wrap;z-index:99"></div>
    <div class="tip hidden" id="agtip"><b>&#128161;</b><span id="agtiptext"></span></div>
    <div class="tv hidden" id="tvcard">
      <div class="tvhead"><b>Trivia</b><span id="tvtime"></span></div>
      <div class="tvq" id="tvq"></div>
      <div id="tvopts"></div>
      <div class="tvbar" id="tvbarbox"><i id="tvfill"></i></div>
      <div class="tvfoot" id="tvfoot"></div>
    </div>
    <div class="card hidden" id="agcard">
      <div class="who"><span class="av"><img class="hidden" referrerpolicy="no-referrer" alt=""><i></i></span><span class="nm" id="agwho"></span><span class="coins hidden" id="agcoins"></span></div>
      <div class="q" id="agq"></div>
      <div class="a" id="aga"></div>
    </div>
  </div></div>
`;

/**
 * Agente IA. Pide la configuración y el estado al canal "agente": arriba la barra con el tamaño de la
 * cola y cuándo sale la próxima pregunta gratis; debajo, la pregunta que se atiende y la respuesta
 * escrita letra a letra. En la vista previa (`demo`) enseña una pregunta de ejemplo.
 */
const AGENTE_JS = `
  var q = new URLSearchParams(location.search);
  var designOverride = q.get("design") || DESIGN_OVERRIDE || null;
  var DEMO = DEMO_MODE || q.get("demo") === "1";
  // "cola" = solo la barra; "respuesta" = pregunta, trivia y avisos sin la barra; vac\u00edo = todo junto.
  var PART = AGENT_PART === "cola" || AGENT_PART === "respuesta" ? AGENT_PART : "";
  if (PART) document.getElementById("ag").setAttribute("data-part", PART);
  var config = null, state = null, retry = 0, ws = null, offset = 0, shown = false;
  var typedId = "", typedLen = 0, typeTimer = null;
  var rootEl = document.getElementById("root"), cardEl = document.getElementById("agcard");
  var nameEl = document.getElementById("agname"), queueEl = document.getElementById("agqueue"), freeEl = document.getElementById("agfree");
  var whoEl = document.getElementById("agwho"), coinsEl = document.getElementById("agcoins"), qEl = document.getElementById("agq"), aEl = document.getElementById("aga");
  var tvEl = document.getElementById("tvcard"), tvTime = document.getElementById("tvtime"), tvQ = document.getElementById("tvq");
  var tvOpts = document.getElementById("tvopts"), tvFill = document.getElementById("tvfill"), tvBar = document.getElementById("tvbarbox"), tvFoot = document.getElementById("tvfoot");
  var avEl = cardEl.querySelector(".av"), imgEl = avEl.querySelector("img"), iniEl = avEl.querySelector("i");
  var DEMO_STATE = { queueSize: 3, queue: [], nextFreeAt: 0, answered: 0, updatedAt: 0, current: { id: "demo", name: "Valentina", question: "\\u00bfCu\\u00e1ntos planetas tiene el sistema solar?", coins: 0, answer: "Ocho: Mercurio, Venus, Tierra, Marte, Júpiter, Saturno, Urano y Neptuno.", startedAt: 0, showMs: 600000 } };

  function applyStyle() {
    var style = config.style;
    document.body.setAttribute("data-design", designOverride || style.designId);
    var root = document.documentElement.style;
    var vars = { "--text": style.textColor, "--bg": style.backgroundColor, "--accent": style.accentColor };
    for (var k in vars) { if (vars[k]) root.setProperty(k, vars[k]); else root.removeProperty(k); }
    root.setProperty("--scale", style.scale || 1);
  }

  function now() { return Date.now() + offset; }

  function renderBar() {
    if (!config || !state) return;
    nameEl.textContent = config.name;
    queueEl.textContent = "Cola " + state.queueSize;
    var left = Math.ceil((state.nextFreeAt - now()) / 1000);
    if (left <= 0) { freeEl.textContent = "Gratis ya"; freeEl.className = "free ready"; }
    else { freeEl.textContent = "Gratis en " + left + " s"; freeEl.className = "free"; }
  }

  var statEl = document.getElementById("agstat"), statText = document.getElementById("agstattext"), nextEl = document.getElementById("agnext"), ntcEl = document.getElementById("agnotices");
  // Línea de estado: qué está haciendo el agente ahora y quién sigue en la fila.
  function renderStatus() {
    if (!config || !state || DEMO) { statEl.classList.add("hidden"); return; }
    var c = state.current, t = tvState && tvState.phase !== "idle", text, nx = state.queue && state.queue[0];
    if (c) text = c.answer ? "Respondiendo a " + c.name : "Pensando la respuesta de " + c.name + "...";
    else if (t) text = "Trivia en curso";
    else if (state.queueSize > 0) text = "Preparando la siguiente pregunta";
    else text = "Libre: escribe " + config.command + " y tu pregunta";
    statText.textContent = text;
    var showNext = nx && (c || t);
    if (showNext) { nextEl.textContent = "Sigue: " + nx.name + (state.queueSize > 1 ? " (+" + (state.queueSize - 1) + ")" : ""); nextEl.classList.remove("hidden"); }
    else nextEl.classList.add("hidden");
    statEl.classList.remove("hidden");
  }

  // Avisos a cada persona (en la fila, subió a Prioridad, gracias): salen una vez, el servidor los quita solos.
  var ntcSeen = {}, ntcIcon = { queue: "\u23F3", gift: "\u{1F381}", thanks: "\u{1F499}" };
  function renderNotices() {
    var list = (!DEMO && state && state.notices) || [], keep = {}, i, n, el;
    for (i = 0; i < list.length; i++) {
      n = list[i]; keep[n.id] = 1;
      if (ntcSeen[n.id]) continue;
      el = document.createElement("div");
      el.className = "ntc"; el.setAttribute("data-id", n.id);
      el.textContent = ntcIcon[n.kind] + " " + n.text;
      ntcEl.appendChild(el);
      ntcSeen[n.id] = el;
      // Solo habla si no hay una respuesta, una trivia ni otra frase en curso (si no, se pisarían).
      if (n.speak && !state.current && !(tvState && tvState.phase !== "idle")) speakText("nt" + n.id, n.text, n.mood);
    }
    for (var id in ntcSeen) if (!keep[id]) { if (ntcSeen[id].parentNode) ntcSeen[id].parentNode.removeChild(ntcSeen[id]); delete ntcSeen[id]; }
  }

  function setAvatar(c) {
    iniEl.textContent = (c.name || "?").trim().charAt(0).toUpperCase();
    if (c.avatarUrl) { imgEl.onerror = function () { imgEl.classList.add("hidden"); }; imgEl.src = c.avatarUrl; imgEl.classList.remove("hidden"); }
    else { imgEl.classList.add("hidden"); imgEl.removeAttribute("src"); }
  }

  ${PICK_VOICE_JS}

  // Lee la respuesta en voz alta con una voz del sistema, una sola vez por pregunta. En la vista previa de demo no habla.
  // Diagnostico de la voz: con ?debug=1 en el enlace se ve en pantalla que pasa con cada frase.
  var DEBUG = q.get("debug") === "1", dbgEl = document.getElementById("agdbg"), dbgLines = [];
  function dbg(msg) {
    if (!DEBUG) return;
    dbgLines.push(new Date().toLocaleTimeString() + " " + msg);
    if (dbgLines.length > 6) dbgLines.shift();
    dbgEl.textContent = dbgLines.join("\\n");
    dbgEl.classList.remove("hidden");
  }
  // Avisa al personaje 3D si suena la voz y con que fuerza (por el sidecar). level -1 = no se sabe (voz del equipo).
  var levelTimer = null;
  function sendSpeech(on, level) {
    if (MUTE_MODE || DEMO || !ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify({ channel: "agente", payload: { kind: "speech", speaking: on, level: level } })); } catch (e) {}
  }
  function stopLevels() { if (levelTimer) { clearInterval(levelTimer); levelTimer = null; } }
  // Volumen de un audio WAV de 16 bits por tramos de 40 ms (0 a 1), para que la boca siga la voz real.
  function wavEnvelope(b64) {
    try {
      var bin = atob(b64), n = bin.length;
      if (n < 60) return null;
      var rate = bin.charCodeAt(24) | (bin.charCodeAt(25) << 8) | (bin.charCodeAt(26) << 16);
      var ch = bin.charCodeAt(22) || 1, bits = bin.charCodeAt(34);
      if (bits !== 16 || rate < 8000) return null;
      var step = Math.max(1, Math.round(rate * 0.04)) * 2 * ch, vals = [], peak = 0, i, j, sum, s16, cnt;
      for (i = 44; i + 1 < n; i += step) {
        sum = 0; cnt = 0;
        for (j = i; j + 1 < i + step && j + 1 < n; j += 2 * ch) {
          s16 = bin.charCodeAt(j) | (bin.charCodeAt(j + 1) << 8);
          if (s16 >= 32768) s16 -= 65536;
          sum += s16 * s16; cnt++;
        }
        var rms = cnt ? Math.sqrt(sum / cnt) : 0;
        vals.push(rms); if (rms > peak) peak = rms;
      }
      if (!peak) return null;
      for (i = 0; i < vals.length; i++) vals[i] = Math.min(1, vals[i] / (peak * 0.75));
      return { win: 0.04, v: vals };
    } catch (e) { return null; }
  }
  function trackLevels(a, env) {
    stopLevels();
    levelTimer = setInterval(function () {
      if (a.paused || a.ended) { sendSpeech(true, 0); return; }
      var k = env ? Math.min(env.v.length - 1, Math.floor(a.currentTime / env.win)) : -1;
      sendSpeech(true, k >= 0 ? env.v[k] : -1);
    }, 60);
  }

  function speak(c) {
    if (!c.answer) return;
    speakText(c.id, (config.voice.readQuestion ? c.name + " pregunta: " + c.question + (/[?!.]$/.test(c.question) ? " " : ". ") : "") + c.answer, c.mood);
  }
  // Voz del equipo (speechSynthesis): la de siempre y el respaldo de la voz de la nube.
  // Ánimo del LIVE (calma, alegre, emocionada...) con la voz del equipo: no sabe actuar, pero sube o baja el ritmo y el tono.
  var liveMood = "calm", MOOD_VOICE = { calm: [1, 1], happy: [1.06, 1.1], excited: [1.15, 1.25], mystery: [0.9, 0.85] };
  function speakSystem(text, v, mood, done) {
    done = done || function () {};
    if (!window.speechSynthesis) { dbg("voz del equipo: este navegador no tiene speechSynthesis"); done(); return; }
    try {
      dbg("voz del equipo: " + window.speechSynthesis.getVoices().length + " voces instaladas");
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var pick = pickVoice(window.speechSynthesis.getVoices(), v.gender, v.voiceName);
      if (pick) { u.voice = pick; u.lang = pick.lang; } else u.lang = "es-ES";
      var mv = MOOD_VOICE[!mood || mood === "auto" ? liveMood : mood] || MOOD_VOICE.calm;
      u.rate = Math.min(2, v.rate * mv[0]); u.pitch = mv[1]; u.volume = v.volume;
      u.onstart = function () { dbg("voz del equipo: hablando"); stopLevels(); sendSpeech(true, -1); levelTimer = setInterval(function () { sendSpeech(true, -1); }, 250); };
      u.onend = function () { done(); };
      u.onerror = function (ev) { dbg("voz del equipo: error " + (ev && ev.error)); done(); };
      window.speechSynthesis.speak(u);
    } catch (e) { dbg("voz del equipo: fallo " + e); done(); }
  }

  // Voz de la nube: el sidecar genera el audio (Gemini) y aqui solo se reproduce, frase a frase.
  var ttsGen = 0, ttsN = 0, ttsWait = {}, curAudio = null, cloudFails = 0, cloudOffUntil = 0;

  function stopSpeech() {
    ttsGen++;
    if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

  // Parte el texto en trozos de ~450 letras (casi todas las respuestas caben en uno: cada trozo es una llamada que cuenta para el limite de Gemini) cortando en el final de una frase.
  function splitSpeech(t) {
    var sentences = t.match(/[^.!?;:\\n]+[.!?;:]*\\s*/g) || [t], out = [], cur = "", i;
    for (i = 0; i < sentences.length; i++) {
      if (cur && (cur + sentences[i]).length > 450) { out.push(cur.trim().slice(0, 590)); cur = ""; }
      cur += sentences[i];
    }
    if (cur.trim()) out.push(cur.trim().slice(0, 590));
    return out.slice(0, 6);
  }

  function requestTts(text, mood) {
    return new Promise(function (resolve) {
      var id = "t" + (++ttsN);
      var timer = setTimeout(function () { delete ttsWait[id]; resolve(null); }, 30000);
      ttsWait[id] = function (m) { clearTimeout(timer); resolve(m); };
      try { ws.send(JSON.stringify({ channel: "agente", payload: { kind: "tts", id: id, text: text, mood: mood } })); }
      catch (e) { clearTimeout(timer); delete ttsWait[id]; resolve(null); }
    });
  }

  function speakCloud(text, mood, v, done) {
    done = done || function () {};
    stopSpeech();
    var gen = ttsGen, chunks = splitSpeech(text), reqs = [], i = 0;
    // se pide un trozo a la vez, con el siguiente adelantado mientras suena el actual (pedirlos todos juntos pasaba el limite por minuto de Gemini)
    function req(k) { if (k < chunks.length && !reqs[k]) reqs[k] = requestTts(chunks[k], mood); return reqs[k]; }
    function fallback(from) {
      cloudFails++;
      if (cloudFails >= 3) cloudOffUntil = now() + 120000;
      speakSystem(chunks.slice(from).join(" "), v, mood, done);
    }
    function next() {
      if (gen !== ttsGen) return;
      if (i >= chunks.length) { done(); return; }
      var idx = i++;
      req(idx).then(function (m) {
        if (gen !== ttsGen) return;
        // limite de uso de Gemini (429): se deja la nube un minuto entero, sin seguir gastando llamadas
        if (m && !m.ok && /429|demasiadas|mite de uso/i.test(m.message || "")) { cloudOffUntil = now() + 60000; cloudFails = 0; dbg("Gemini: limite de uso del plan; voz del equipo durante 1 minuto"); speakSystem(chunks.slice(idx).join(" "), v, mood, done); return; }
        if (!m || !m.ok) { dbg("Gemini: sin audio (" + (m ? (m.message || "error") : "sin respuesta en 30 s") + "), uso la voz del equipo"); fallback(idx); return; }
        dbg("Gemini: audio recibido (" + Math.round((m.data || "").length / 1366) + " KB)");
        var env = wavEnvelope(m.data);
        cloudFails = 0;
        req(idx + 1);
        var a = new Audio("data:" + m.mime + ";base64," + m.data);
        a.volume = v.volume; a.playbackRate = v.rate;
        curAudio = a;
        a.onended = function () { stopLevels(); next(); };
        a.onerror = function () { dbg("audio: el navegador no pudo leer el archivo"); if (gen === ttsGen) fallback(idx); };
        var pr = a.play();
        if (pr && pr.then) pr.then(function () { dbg("audio: reproduciendo"); trackLevels(a, env); });
        if (pr && pr.catch) pr.catch(function (e) { dbg("audio: BLOQUEADO (" + (e && e.name) + "): el navegador no deja sonar sin un clic"); if (gen === ttsGen) fallback(idx); });
      });
    }
    next();
  }

  function speakText(key, text, mood) {
    var v = config && config.voice;
    if (!v || !v.enabled || DEMO || MUTE_MODE || PART === "cola" || spokenKeys[key]) {
      if (!spokenKeys[key]) dbg("no habla: " + (!v ? "sin config" : !v.enabled ? "voz apagada" : DEMO ? "demo" : MUTE_MODE ? "vista previa" : "parte cola"));
      return;
    }
    var cloud = v.provider === "gemini" && ws && ws.readyState === 1 && now() >= cloudOffUntil;
    if (!cloud && !window.speechSynthesis) return;
    spokenKeys[key] = 1;
    // Una frase nueva espera a que acabe la que suena (antes la cortaba a media pregunta); la fila guarda las ultimas 3.
    if (speaking) {
      dbg("en fila: " + text.slice(0, 40));
      speechQ.push({ text: text, mood: mood });
      while (speechQ.length > 3) speechQ.shift();
      return;
    }
    startSpeech(text, mood);
  }

  var spokenKeys = {}, speaking = false, speechQ = [], speechWatch = null;
  function startSpeech(text, mood) {
    var v = config && config.voice, finished = false;
    if (!v) return;
    speaking = true;
    function fin() {
      if (finished) return;
      finished = true;
      if (speechWatch) { clearTimeout(speechWatch); speechWatch = null; }
      stopLevels();
      speaking = false;
      if (!speechQ.length) sendSpeech(false, 0);
      var n = speechQ.shift();
      if (n) startSpeech(n.text, n.mood);
    }
    // por si el navegador nunca avisa que acabo, la fila no se queda trabada
    speechWatch = setTimeout(fin, Math.min(90000, text.length * 120 + 15000));
    dbg("voz: " + v.provider + ", conexion " + (ws ? ws.readyState : "ninguna") + " - " + text.slice(0, 40));
    if (v.provider === "gemini" && ws && ws.readyState === 1 && now() >= cloudOffUntil) speakCloud(text, mood || "auto", v, fin);
    else { stopSpeech(); speakSystem(text, v, mood, fin); }
  }

  function typeStep() {
    var c = state && state.current;
    if (!c || !c.answer) return;
    typedLen = Math.min(c.answer.length, typedLen + 2);
    aEl.textContent = c.answer.slice(0, typedLen);
    if (typedLen < c.answer.length) { var cur = document.createElement("span"); cur.className = "cur"; aEl.appendChild(cur); }
    else { clearInterval(typeTimer); typeTimer = null; }
  }

  var LETTERS = ["A", "B", "C", "D"], tvKey = "", tvState = null;

  function renderTrivia() {
    var t = tvState;
    if (!t || t.phase === "idle" || DEMO) { tvEl.classList.add("hidden"); tvKey = ""; return; }
    tvEl.classList.remove("hidden");
    var key = t.phase + t.startedAt, total = ((config.trivia && config.trivia.answerSec) || 30) * 1000;
    if (t.phase === "generating") {
      tvQ.textContent = "Preparando una pregunta...";
      tvOpts.innerHTML = ""; tvBar.classList.add("hidden"); tvFoot.textContent = ""; tvTime.textContent = "";
      return;
    }
    if (tvKey !== key) {
      tvKey = key;
      tvQ.textContent = t.question;
      var html = "", i;
      for (i = 0; i < t.options.length; i++) html += '<div class="tvopt" data-i="' + i + '"><b>' + LETTERS[i] + "</b><span></span></div>";
      tvOpts.innerHTML = html;
      for (i = 0; i < t.options.length; i++) tvOpts.children[i].lastChild.textContent = t.options[i];
      if (t.phase === "open") speakText("tv" + t.startedAt, "Trivia. " + t.question + " " + t.options.map(function (o, n) { return LETTERS[n] + ": " + o + "."; }).join(" "), "happy");
      if (t.phase === "reveal") {
        var ok = t.options[t.correct];
        speakText("tvr" + t.startedAt, t.winner ? "La respuesta correcta es " + LETTERS[t.correct] + ": " + ok + ". Acert\u00f3 " + t.winner.name + "." : "Nadie acert\u00f3. La respuesta correcta era " + LETTERS[t.correct] + ": " + ok + ".", t.winner ? "happy" : "calm");
      }
    }
    if (t.phase === "open") {
      var left = Math.max(0, t.deadline - now());
      tvTime.textContent = Math.ceil(left / 1000) + " s";
      tvBar.classList.remove("hidden");
      tvFill.style.width = Math.min(100, (left / total) * 100) + "%";
      tvFoot.className = "tvfoot";
      tvFoot.textContent = "Escribe " + LETTERS.slice(0, t.options.length).join(", ") + " en el chat";
    } else {
      tvTime.textContent = ""; tvBar.classList.add("hidden");
      for (var j = 0; j < tvOpts.children.length; j++) tvOpts.children[j].className = "tvopt " + (j === t.correct ? "ok" : "dim");
      tvFoot.className = "tvfoot" + (t.winner ? " win" : "");
      tvFoot.textContent = t.winner ? "\u{1F3C6} \u00a1Acert\u00f3 " + t.winner.name + "!" : "Nadie acert\u00f3";
    }
  }

  function renderCard() {
    var c = state && state.current;
    if (!c) { cardEl.classList.add("hidden"); typedId = ""; if (typeTimer) { clearInterval(typeTimer); typeTimer = null; } return; }
    if (typedId !== c.id) {
      typedId = c.id; typedLen = 0;
      cardEl.classList.remove("in"); void cardEl.offsetWidth; cardEl.classList.add("in");
      whoEl.textContent = c.name; qEl.textContent = c.question; aEl.textContent = "";
      setAvatar(c);
      if (c.coins > 0) { coinsEl.textContent = c.coins + " \\u{1FA99}"; coinsEl.classList.remove("hidden"); } else coinsEl.classList.add("hidden");
    }
    cardEl.classList.remove("hidden");
    if (!c.answer) { aEl.textContent = "Pensando..."; return; }
    speak(c);
    if (!typeTimer && typedLen < c.answer.length) typeTimer = setInterval(typeStep, 35);
  }

  var tipEl = document.getElementById("agtip"), tipText = document.getElementById("agtiptext");
  // El aviso periódico (cómo participar) se ve solo si no hay respuesta ni trivia en pantalla.
  function renderTip() {
    var tip = state && state.tip, hide = !tip || DEMO || state.current || (tvState && tvState.phase !== "idle");
    if (hide) { tipEl.classList.add("hidden"); return; }
    tipText.textContent = tip.text;
    tipEl.classList.remove("hidden");
    speakText(tip.id, tip.text);
  }

  function render() {
    renderBar();
    renderStatus();
    renderTrivia();
    renderCard();
    renderNotices();
    renderTip();
    if (!shown) { shown = true; rootEl.classList.remove("hidden"); }
  }

  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }

  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () {
      retry = 0;
      ws.send(JSON.stringify({ channel: "agente", payload: { kind: "get-state" } }));
      if (!MUTE_MODE && !DEMO) ws.send(JSON.stringify({ channel: "agente", payload: { kind: "overlay-hello", speaks: PART !== "cola" } }));
    };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel === "agente" && m.payload && m.payload.kind === "tts-audio") {
          var waiter = ttsWait[m.payload.id];
          if (waiter) { delete ttsWait[m.payload.id]; waiter(m.payload); }
          return;
        }
        if (m.channel !== "agente" || !m.payload || m.payload.kind !== "state") return;
        config = m.payload.config;
        state = DEMO ? DEMO_STATE : m.payload.state;
        liveMood = !DEMO && m.payload.animo && config.animo && config.animo.enabled ? m.payload.animo.mood : "calm";
        tvState = DEMO ? null : m.payload.trivia;
        offset = m.payload.serverNow - Date.now();
        applyStyle();
        render();
        document.documentElement.setAttribute("data-ready", "1");
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  setInterval(function () { renderBar(); if (tvState && tvState.phase === "open") renderTrivia(); }, 250);
  try { if (window.speechSynthesis) window.speechSynthesis.getVoices(); } catch (e) {}
  document.body.setAttribute("data-design", designOverride || "panel");
  connect();
`;

/** Texto como literal JS seguro dentro de un <script> (escapa `<` para que no cierre la etiqueta). */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface OverlayPageOptions {
  /** Diseño forzado (vista previa dentro de la app, donde no hay `?design=`). */
  design?: string;
  /** Id de la instancia (`meta`, `nivel`, `duelo` y `top`): qué meta, alerta o duelo dibuja. Vacío = la primera. */
  id?: string;
  /** Vista previa de la app: `nivel`, `duelo` y `top` enseñan datos de ejemplo sin esperar al LIVE. */
  demo?: boolean;
  /** Sin voz: la vista previa dentro de la app enseña lo mismo que el stream pero no habla (si no, se oiría doble). */
  mute?: boolean;
}

export function overlayPage(kind: OverlayKind, wsPort: number, opts: OverlayPageOptions = {}): string {
  // el personaje 3D del agente es una página aparte (lleva three.js y no usa el diseño ni la voz del resto)
  if (kind === "agente" && opts.id === "personaje") return personajePage(wsPort, { demo: opts.demo, mute: opts.mute });
  const meta = kind === "meta";
  const nivel = kind === "nivel";
  const duelo = kind === "duelo";
  const top = kind === "top";
  const agente = kind === "agente";
  const css = agente ? AGENTE_CSS : top ? TOP_CSS : duelo ? DUELO_CSS : nivel ? NIVEL_CSS : meta ? META_CSS : kind === "timer" ? TIMER_CSS : WINS_CSS;
  const body = agente ? AGENTE_BODY : top ? TOP_BODY : duelo ? DUELO_BODY : nivel ? NIVEL_BODY : meta ? META_BODY : kind === "timer" ? TIMER_BODY : WINS_BODY;
  const kindJs = nivel || duelo || top || agente ? "" : meta ? META_JS : kind === "timer" ? TIMER_JS : WINS_JS;
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
  var GOAL_ID = ${jsString(opts.id ?? "")};
  var ALERT_ID = ${jsString(opts.id ?? "")};
  var DUEL_ID = ${jsString(opts.id ?? "")};
  var TOP_ID = ${jsString(opts.id ?? "")};
  var AGENT_PART = ${jsString(opts.id ?? "")};
  var DEMO_MODE = ${opts.demo ? "true" : "false"};
  var MUTE_MODE = ${opts.mute ? "true" : "false"};
  // Funciones de dibujo de este overlay (definen render()).
  ${kindJs}
  // Conexión, estado y estilo comunes.
  ${agente ? AGENTE_JS : top ? TOP_JS : duelo ? DUELO_JS : nivel ? NIVEL_JS : meta ? META_COMMON_JS : COMMON_JS}
})();
</script>
</body></html>`;
}
