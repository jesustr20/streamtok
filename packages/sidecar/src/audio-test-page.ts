/**
 * Página de prueba de audio (`/overlay/prueba-audio`).
 *
 * Sirve para saber, antes de construir el Agente IA (ADR 0016), si el navegador donde se muestra el overlay
 * (OBS, TikTok LIVE Studio…) reproduce sonido y voz. Cada 8 s prueba tres caminos y escribe el resultado en
 * pantalla (para hacerle una captura):
 *   1. Tono con Web Audio.
 *   2. Un archivo WAV generado al vuelo con `<audio>` (el camino que usaría el agente: el sidecar genera el audio
 *      y el overlay solo lo reproduce).
 *   3. La voz del sistema con `speechSynthesis` (puede no existir o no tener voces en LIVE Studio).
 */
export function audioTestPage(): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamTok · prueba de audio</title>
<style>
  html,body{margin:0;background:transparent;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#fff}
  #box{width:560px;box-sizing:border-box;margin:12px;padding:16px 18px;border-radius:14px;background:rgba(14,15,18,.92);border:1px solid #2a2c33}
  h1{font-size:16px;margin:0 0 4px}
  p{margin:0 0 10px;font-size:12px;color:#9a9ca5;line-height:1.45}
  .row{display:flex;gap:10px;align-items:baseline;font-size:14px;padding:5px 0;border-top:1px solid #1f2127}
  .mark{width:20px;text-align:center;font-weight:800}
  .ok .mark{color:#34d399}.bad .mark{color:#e5484d}.wait .mark{color:#f5a524}
  .name{width:150px;font-weight:700}
  .msg{flex:1;color:#c9cbd2;font-size:12.5px;word-break:break-word}
  button{margin-top:12px;padding:8px 14px;border:0;border-radius:8px;background:#e8365d;color:#fff;font-weight:700;cursor:pointer}
</style>
</head>
<body>
<div id="box">
  <h1>Prueba de audio de StreamTok</h1>
  <p>Debes oír un pitido, otro pitido (archivo) y una frase hablada cada 8 segundos. Si no oyes algo, mira la línea de abajo: dice qué falló. Haz una captura y pásala.</p>
  <div class="row wait" id="r-ctx"><span class="mark">…</span><span class="name">Web Audio</span><span class="msg">esperando</span></div>
  <div class="row wait" id="r-file"><span class="mark">…</span><span class="name">Archivo de audio</span><span class="msg">esperando</span></div>
  <div class="row wait" id="r-tts"><span class="mark">…</span><span class="name">Voz del sistema</span><span class="msg">esperando</span></div>
  <div class="row wait" id="r-env"><span class="mark">i</span><span class="name">Navegador</span><span class="msg" id="env"></span></div>
  <button id="go">Probar ahora</button>
</div>
<script>
(function () {
  var PHRASE = "Hola, esta es la prueba de voz de StreamTok.";
  function set(id, state, msg) {
    var r = document.getElementById(id);
    r.className = "row " + state;
    r.querySelector(".mark").textContent = state === "ok" ? "✔" : state === "bad" ? "✖" : "…";
    r.querySelector(".msg").textContent = msg;
  }
  document.getElementById("env").textContent = navigator.userAgent;

  function tone() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return set("r-ctx", "bad", "este navegador no tiene Web Audio");
      var ctx = new C();
      var go = function () {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.frequency.value = 660;
        g.gain.value = 0.2;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.4);
        set("r-ctx", "ok", "estado " + ctx.state + " · pitido enviado (¿lo oíste?)");
        setTimeout(function () { ctx.close(); }, 800);
      };
      if (ctx.state === "suspended") {
        ctx.resume().then(go, function (e) { set("r-ctx", "bad", "bloqueado: " + e); });
        setTimeout(function () { if (ctx.state === "suspended") set("r-ctx", "bad", "el navegador bloquea el audio hasta que alguien pulse (pulsa «Probar ahora»)"); }, 600);
      } else go();
    } catch (e) { set("r-ctx", "bad", String(e)); }
  }

  // WAV de un tono, generado aquí mismo (16 bits, 22050 Hz, 0,5 s)
  function wavUrl() {
    var rate = 22050, n = rate / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * 9000, true);
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function file() {
    try {
      var a = new Audio(wavUrl());
      a.volume = 0.6;
      var p = a.play();
      if (p && p.then) p.then(function () { set("r-file", "ok", "reproduciendo el archivo (¿lo oíste?)"); }, function (e) { set("r-file", "bad", "no se pudo reproducir: " + (e && e.name ? e.name + " – " + e.message : e)); });
      else set("r-file", "ok", "enviado (este navegador no informa del resultado)");
    } catch (e) { set("r-file", "bad", String(e)); }
  }

  function voice() {
    var ss = window.speechSynthesis;
    if (!ss || typeof SpeechSynthesisUtterance === "undefined") return set("r-tts", "bad", "este navegador no tiene voz del sistema (speechSynthesis)");
    var voices = ss.getVoices();
    var es = voices.filter(function (x) { return /^es/i.test(x.lang); });
    var u = new SpeechSynthesisUtterance(PHRASE);
    u.lang = "es-ES";
    if (es[0]) u.voice = es[0];
    var info = voices.length + " voces (" + es.length + " en español)";
    if (voices.length === 0) { set("r-tts", "bad", "0 voces instaladas o aún no cargadas · " + info); }
    u.onstart = function () { set("r-tts", "ok", "hablando · " + info + (es[0] ? " · " + es[0].name : "")); };
    u.onerror = function (e) { set("r-tts", "bad", "error: " + (e && e.error) + " · " + info); };
    ss.cancel();
    ss.speak(u);
  }

  function all() { tone(); file(); voice(); }
  document.getElementById("go").onclick = all;
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = function () {};
  setTimeout(all, 500);
  setInterval(all, 8000);
})();
</script>
</body></html>`;
}
