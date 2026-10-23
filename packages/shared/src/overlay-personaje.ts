/**
 * Overlay del personaje 3D del agente de IA (`/overlay/agente/personaje`).
 *
 * Un chibi ninja (Nova, aprendiz de la Aldea de la Estrella Fugaz) dibujado con three.js que sigue el
 * ánimo del LIVE (calma, alegre, emocionada, misterio), mueve la boca mientras suena una respuesta o un
 * aviso en voz alta y celebra los regalos y los subidones. Fondo transparente o verde croma, con piso.
 *
 * Carga three.js 0.152.2 desde jsDelivr (sin dependencia npm nueva). El JavaScript va en una cadena:
 * sin acentos graves ni "${" ni barras invertidas (la prueba de la página lo comprueba).
 */

export const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js";

const PERSONAJE_CSS = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  #root { position: fixed; inset: 0; }
  #root[data-fixed="1"] { inset: auto; left: 0; top: 0; width: 400px; height: 460px; }
  #stage { position: absolute; inset: 0; }
  #stage canvas { display: block; width: 100%; height: 100%; }
  #nomsg { position: absolute; left: 8px; top: 8px; right: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(20, 16, 40, .85); color: #fff; font: 600 13px/1.4 "Segoe UI", system-ui, sans-serif; }
`;

export const PERSONAJE_JS = `
(function () {
  var WS_PORT = __WS_PORT__;
  var DEMO_MODE = __DEMO__;
  var host = document.getElementById("stage");
  var THREE = window.THREE;
  var QBG = new URLSearchParams(location.search).get("bg") || "";
  var DEMO = DEMO_MODE || new URLSearchParams(location.search).get("demo") === "1";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var renderer;
  try {
    if (!THREE) throw new Error("three");
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    var m = document.createElement("div");
    m.id = "nomsg";
    m.textContent = "No se pudo iniciar el 3D (hace falta internet para cargar three.js y WebGL).";
    host.appendChild(m);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(27, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x5b4fb0, 0.55));
  var sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(3, 5, 5);
  scene.add(sun);
  var rim = new THREE.DirectionalLight(0x9fb4ff, 0.5);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  var grad = new THREE.DataTexture(new Uint8Array([85, 165, 255]), 3, 1, THREE.RedFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.needsUpdate = true;
  function toon(c, extra) { return new THREE.MeshToonMaterial(Object.assign({ color: c, gradientMap: grad }, extra || {})); }
  var outMat = new THREE.MeshBasicMaterial({ color: 0x1b1033, side: THREE.BackSide });
  function mk(geo, mat, out, parent, x, y, z) {
    var me = new THREE.Mesh(geo, mat);
    me.position.set(x || 0, y || 0, z || 0);
    if (out) { var o = new THREE.Mesh(geo, outMat); o.scale.setScalar(out === true ? 1.05 : out); me.add(o); }
    if (parent) parent.add(me);
    return me;
  }
  function grp(parent, x, y, z) { var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; }

  var SKIN = 0xf7cdb8, HAIR = 0xd9cdff, HAIR2 = 0xa391f5, DRESS = 0x26295f, GOLD = 0xffc94d, SHOE = 0x3b2f73;
  var skin = toon(SKIN), hair = toon(HAIR), hair2 = toon(HAIR2), dress = toon(DRESS), gold = toon(GOLD, { emissive: 0x3d2900 }), shoe = toon(SHOE);

  function star(r, ri, depth) {
    var s = new THREE.Shape(), i, a, rr;
    for (i = 0; i < 10; i++) {
      a = Math.PI / 2 + i * Math.PI / 5; rr = i % 2 ? ri : r;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: depth * .4, bevelSize: r * .12, bevelSegments: 2 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  /* ---------- texturas de la cara ---------- */
  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c) { var t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t; }
  var DARK = '#1a1033';
  function eyeCanvas(kind) {
    var c = cv(128, 160), x = c.getContext('2d');
    x.lineCap = 'round';
    if (kind === 'arc') {
      x.strokeStyle = DARK; x.lineWidth = 14; x.beginPath(); x.arc(64, 112, 38, Math.PI * 1.12, Math.PI * 1.88); x.stroke();
      return c;
    }
    var g = x.createLinearGradient(0, 24, 0, 148);
    g.addColorStop(0, '#4a2fc4'); g.addColorStop(0.55, '#7e63f0'); g.addColorStop(1, '#c8b7ff');
    x.fillStyle = g; x.beginPath(); x.ellipse(64, 88, 44, 62, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = DARK; x.beginPath(); x.ellipse(64, 90, 22, 36, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff';
    x.beginPath(); x.arc(46, 62, 13, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(84, 116, 7, 0, Math.PI * 2); x.fill();
    if (kind === 'sparkle') {
      x.fillStyle = '#fff'; x.beginPath();
      var cx = 64, cy = 90, R = 20, r = 5, i, a;
      for (i = 0; i < 8; i++) { a = i * Math.PI / 4 - Math.PI / 2; var rr = i % 2 ? r : R; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.closePath(); x.fill();
    }
    x.strokeStyle = DARK; x.lineWidth = 12; x.beginPath(); x.ellipse(64, 88, 44, 62, 0, Math.PI * 1.08, Math.PI * 1.92); x.stroke();
    if (kind === 'half') {
      x.clearRect(0, 0, 128, 84);
      x.strokeStyle = DARK; x.lineWidth = 12; x.beginPath(); x.moveTo(16, 86); x.lineTo(112, 86); x.stroke();
    }
    return c;
  }
  var eyeTex = { open: tex(eyeCanvas('open')), arc: tex(eyeCanvas('arc')), sparkle: tex(eyeCanvas('sparkle')), half: tex(eyeCanvas('half')) };
  function mouthCanvas(kind) {
    var c = cv(128, 64), x = c.getContext('2d');
    x.lineCap = 'round'; x.strokeStyle = DARK; x.fillStyle = DARK; x.lineWidth = 9;
    if (kind === 'smile') { x.beginPath(); x.arc(64, 14, 30, Math.PI * .2, Math.PI * .8); x.stroke(); }
    else if (kind === 'open') {
      x.beginPath(); x.moveTo(22, 12); x.quadraticCurveTo(64, 74, 106, 12); x.closePath(); x.fill();
      x.fillStyle = '#ff7fa8'; x.beginPath(); x.ellipse(64, 46, 22, 11, 0, 0, Math.PI * 2); x.fill();
    } else { x.beginPath(); x.ellipse(64, 32, 11, 14, 0, 0, Math.PI * 2); x.fill(); }
    return c;
  }
  var mouthTex = { smile: tex(mouthCanvas('smile')), open: tex(mouthCanvas('open')), o: tex(mouthCanvas('o')) };
  var blushC = cv(64, 64), bx = blushC.getContext('2d'), bg = bx.createRadialGradient(32, 32, 2, 32, 32, 30);
  bg.addColorStop(0, 'rgba(255,110,160,.95)'); bg.addColorStop(1, 'rgba(255,110,160,0)'); bx.fillStyle = bg; bx.fillRect(0, 0, 64, 64);
  var blushTex = tex(blushC);

  var turn = grp(scene, 0, 0, 0);
  var root = grp(turn, 0, 0, 0);

  // piso (no salta con el personaje)
  var floorG = grp(turn, 0, 0, 0);
  mk(new THREE.CylinderGeometry(1.15, 1.25, 0.16, 56), toon(0x2b2656), true, floorG, 0, -0.08, 0);
  var ring = mk(new THREE.TorusGeometry(1.15, 0.025, 10, 80), gold, false, floorG, 0, 0.005, 0);
  ring.rotation.x = Math.PI / 2;
  var gc = cv(128, 128), gx = gc.getContext('2d'), gr = gx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(185,166,255,.7)'); gr.addColorStop(1, 'rgba(185,166,255,0)'); gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
  var pool = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), new THREE.MeshBasicMaterial({ map: tex(gc), transparent: true, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.012; floorG.add(pool);

  var i, body = grp(root, 0, 0, 0);
  var NAVY = toon(0x24286b), NAVY2 = toon(0x1b1e52), VIO = toon(0x5b49c9), WHITE = toon(0xf2eefc), SILVER = toon(0xc9d3e6);
  var scarfMat = toon(0xffc94d), hairMat = toon(0x3a3f9e), hairHi = toon(0x6f6be0);
  // piernas, vendas y sandalias
  var s2;
  for (s2 = -1; s2 <= 1; s2 += 2) {
    mk(new THREE.CapsuleGeometry(0.085, 0.3, 6, 12), skin, true, body, s2 * 0.15, 0.33, 0);
    var sh = mk(new THREE.SphereGeometry(0.15, 20, 14), NAVY2, true, body, s2 * 0.15, 0.1, 0.05);
    sh.scale.set(1, 0.62, 1.5);
    mk(new THREE.SphereGeometry(0.075, 12, 10), skin, false, body, s2 * 0.15, 0.1, 0.2).scale.set(1.1, 0.6, 0.8);
    mk(new THREE.CylinderGeometry(0.135, 0.15, 0.24, 20), NAVY2, true, body, s2 * 0.15, 0.62, 0);
  }
  [0.4, 0.45, 0.5].forEach(function (y) {
    mk(new THREE.TorusGeometry(0.095, 0.022, 8, 20), WHITE, false, body, 0.15, y, 0).rotation.x = Math.PI / 2;
  });
  // chaqueta: faldon, torso, cierre y estrella
  mk(new THREE.CylinderGeometry(0.31, 0.37, 0.24, 32), VIO, true, body, 0, 0.93, 0);
  mk(new THREE.TorusGeometry(0.37, 0.028, 8, 48), gold, false, body, 0, 0.82, 0).rotation.x = Math.PI / 2;
  mk(new THREE.CylinderGeometry(0.27, 0.31, 0.46, 28), NAVY, true, body, 0, 1.22, 0);
  mk(new THREE.BoxGeometry(0.024, 0.62, 0.02), gold, false, body, 0, 1.1, 0.325);
  var badge = mk(star(0.075, 0.034, 0.02), gold, false, body, 0.12, 1.27, 0.3);
  var back = mk(star(0.17, 0.075, 0.03), gold, false, body, 0, 1.18, -0.3);
  back.rotation.y = Math.PI;
  // capucha caida y bufanda con cola
  mk(new THREE.SphereGeometry(0.3, 20, 14), NAVY, true, body, 0, 1.4, -0.26).scale.set(1.25, 0.7, 0.75);
  mk(new THREE.TorusGeometry(0.3, 0.095, 10, 32), scarfMat, true, body, 0, 1.44, 0).rotation.x = Math.PI / 2;
  var scarf = [], sg = grp(body, 0.12, 1.42, -0.3), sprev = sg;
  for (i = 0; i < 5; i++) {
    var seg = grp(sprev, 0, i ? -0.2 : 0, 0);
    mk(new THREE.BoxGeometry(0.21 - i * 0.012, 0.22, 0.05), scarfMat, true, seg, 0, -0.11, 0);
    scarf.push(seg); sprev = seg;
  }
  // brazos
  function makeArm(side) {
    var g = grp(body, side * 0.34, 1.34, 0.12);
    mk(new THREE.CylinderGeometry(0.095, 0.125, 0.32, 18), NAVY, true, g, 0, -0.17, 0);
    mk(new THREE.TorusGeometry(0.1, 0.03, 8, 20), VIO, false, g, 0, -0.34, 0).rotation.x = Math.PI / 2;
    mk(new THREE.CapsuleGeometry(0.07, 0.18, 6, 10), skin, true, g, 0, -0.42, 0);
    mk(new THREE.SphereGeometry(0.095, 16, 12), skin, true, g, 0, -0.58, 0);
    return g;
  }
  var armR = makeArm(1), armL = makeArm(-1);

  // cabeza
  var head = grp(body, 0, 1.95, 0);
  var hsk = mk(new THREE.SphereGeometry(0.62, 40, 30), skin, true, head, 0, 0, 0);
  hsk.scale.set(1, 0.92, 0.97);
  var eyes = [];
  [-1, 1].forEach(function (sd) {
    var e = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.34), new THREE.MeshBasicMaterial({ map: eyeTex.open, transparent: true }));
    e.position.set(sd * 0.23, -0.07, 0.575);
    e.rotation.y = sd * 0.36;
    head.add(e); eyes.push(e);
    var b = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false, opacity: 0.4 }));
    b.position.set(sd * 0.4, -0.23, 0.46); b.rotation.y = sd * 0.8;
    head.add(b); e.userData.blush = b;
  });
  var mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: mouthTex.smile, transparent: true }));
  mouth.position.set(0, -0.3, 0.55); mouth.rotation.x = 0.18; head.add(mouth);
  var mark = mk(star(0.035, 0.016, 0.01), gold, false, head, -0.36, -0.2, 0.5);
  mark.rotation.y = -0.75;

  // pelo: casquete + puntas + mechones
  var back2 = mk(new THREE.SphereGeometry(0.66, 32, 24), hairMat, true, head, 0, 0.0, -0.14);
  back2.scale.set(1.0, 1.0, 0.88);
  var cap = mk(new THREE.SphereGeometry(0.665, 40, 26, 0, Math.PI * 2, 0, Math.PI * 0.4), hairMat, false, head, 0, 0.06, -0.02);
  cap.rotation.x = -0.5;
  function spike(az, el, len, rad, mat) {
    var ce = Math.cos(el), d = new THREE.Vector3(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce).normalize();
    var m = mk(new THREE.ConeGeometry(rad, len, 8), mat || hairMat, true, head, d.x * 0.6, d.y * 0.58 + 0.04, d.z * 0.6);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    m.position.addScaledVector(d, len * 0.3);
    return m;
  }
  var D = Math.PI / 180;
  [-28, 0, 28].forEach(function (az) { spike(az * D, 62 * D, 0.42, 0.13, hairHi); });
  [-70, -35, 35, 70].forEach(function (az) { spike(az * D, 50 * D, 0.38, 0.13); });
  [-120, -85, 85, 120, 150, -150, 180].forEach(function (az) { spike(az * D, 40 * D, 0.4, 0.14); });
  [-150, -110, -60, 60, 110, 150, 0, 180].forEach(function (az) { spike(az * D, 78 * D, 0.38, 0.12, hairHi); });
  [-1, 1].forEach(function (sd) {
    var lock = mk(new THREE.ConeGeometry(0.1, 0.62, 10), hairMat, true, head, sd * 0.58, -0.08, 0.28);
    lock.rotation.x = Math.PI; lock.rotation.z = sd * 0.12;
  });
  // protector de frente con la estrella
  var band = mk(new THREE.TorusGeometry(0.585, 0.06, 10, 48), NAVY2, true, head, 0, 0.27, -0.01);
  band.rotation.x = Math.PI / 2; band.scale.set(1, 1.0, 1);
  var plate = mk(new THREE.BoxGeometry(0.46, 0.25, 0.05), SILVER, true, head, 0, 0.27, 0.585);
  plate.rotation.x = -0.12;
  var pc = cv(184, 100), px = pc.getContext('2d');
  px.fillStyle = '#1b1e52'; px.beginPath();
  (function () { var k, a2, r; for (k = 0; k < 10; k++) { a2 = -Math.PI / 2 + k * Math.PI / 5; r = k % 2 ? 15 : 36; px.lineTo(62 + Math.cos(a2) * r, 50 + Math.sin(a2) * r); } })();
  px.closePath(); px.fill();
  px.strokeStyle = '#1b1e52'; px.lineWidth = 7; px.lineCap = 'round'; px.beginPath(); px.moveTo(98, 46); px.quadraticCurveTo(132, 48, 166, 30); px.stroke();
  var emb = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.228), new THREE.MeshBasicMaterial({ map: tex(pc), transparent: true }));
  emb.position.set(0, 0, 0.027); plate.add(emb);
  var bandTails = [];
  [-1, 1].forEach(function (sd) {
    var pv = grp(head, sd * 0.1, 0.27, -0.62);
    var t1 = mk(new THREE.BoxGeometry(0.15, 0.5, 0.03), NAVY2, true, pv, 0, -0.25, 0);
    pv.userData.side = sd; pv.rotation.x = 0.2;
    bandTails.push(pv);
  });
  var tails = bandTails, clip = mk(new THREE.SphereGeometry(0.01, 4, 4), gold, false, head, 0, 0, 0);

  // estrellas que orbitan
  var orbs = [];
  for (i = 0; i < 4; i++) {
    var st = mk(star(0.1 + i * 0.012, 0.045, 0.03), gold, false, turn, 0, 0, 0);
    st.userData = { ph: i * Math.PI / 2, h: 0.9 + i * 0.55, r: 1.35 + (i % 2) * 0.2 };
    orbs.push(st);
  }

  var MOODS = {
    calm: { name: 'Calma', say: 'Claro, te lo explico con calma.', eye: 'open', mouth: 'smile', blush: 0.35, hop: 0, hopS: 2, breath: 0.03, tail: 0.07, tilt: 0.05, spinEvery: 0, talk: 0, orb: 0.4, size: 1,
      R: { rz: 0.14, amp: 0.05, sp: 1.3, rx: 0 }, L: { rz: -0.14, amp: 0.05, sp: 1.1, rx: 0 } },
    happy: { name: 'Alegre', say: '¡Gracias por seguirnos, que bonito!', eye: 'open', mouth: 'open', blush: 0.8, hop: 0.1, hopS: 7, breath: 0.02, tail: 0.25, tilt: 0.12, spinEvery: 9, talk: 0.25, orb: 1, size: 1,
      R: { rz: 2.0, amp: 0.35, sp: 9, rx: 0 }, L: { rz: -0.4, amp: 0.08, sp: 2, rx: 0 } },
    excited: { name: 'Emocionada', say: '¡Wow, que regalo! ¡Mil gracias!', eye: 'sparkle', mouth: 'open', blush: 0.9, hop: 0.26, hopS: 9.5, breath: 0.02, tail: 0.5, tilt: 0.1, spinEvery: 5, talk: 0.9, orb: 2.4, size: 1,
      R: { rz: 2.1, amp: 0.5, sp: 12, rx: 0 }, L: { rz: -2.1, amp: 0.5, sp: 12.5, rx: 0 } },
    mystery: { name: 'Misterio', say: 'Shh… te cuento un dato secreto.', eye: 'half', mouth: 'o', blush: 0.2, hop: 0, hopS: 2, breath: 0.015, tail: 0.04, tilt: -0.14, spinEvery: 0, talk: 0, orb: 0.7, size: 0.96,
      R: { rz: 3.4, amp: 0.02, sp: 1, rx: 0.9 }, L: { rz: -0.2, amp: 0.03, sp: 1, rx: 0 } }
  };
  var order = ['calm', 'happy', 'excited', 'mystery'];
  /* ---------- fondo, piso y colores (vienen de la config) ---------- */
  var cur = "", P = JSON.parse(JSON.stringify(MOODS.calm)), burstUntil = 0, talkUntil = 0, mouthKind = "";
  var floorOn = true, bgMode = "transparent";
  function applyChar(ch) {
    ch = ch || {};
    try {
      if (/^#[0-9a-fA-F]{6}$/.test(ch.scarfColor || "")) scarfMat.color.set(ch.scarfColor);
      if (/^#[0-9a-fA-F]{6}$/.test(ch.hairColor || "")) { hairMat.color.set(ch.hairColor); hairHi.color.set(ch.hairColor).offsetHSL(0, 0, 0.14); }
    } catch (e) {}
    floorOn = ch.floor !== false;
    floorG.visible = floorOn;
    var bg = QBG === "chroma" || QBG === "transparent" ? QBG : (ch.background === "chroma" ? "chroma" : "transparent");
    if (bg !== bgMode) {
      bgMode = bg;
      if (bg === "chroma") renderer.setClearColor(0x00b140, 1); else renderer.setClearColor(0x000000, 0);
      pool.visible = bg !== "chroma";
    }
  }

  /* ---------- gestos ---------- */
  var parts = [];
  function spawn() {
    var p = mk(star(0.07, 0.03, 0.02), gold, false, turn, (Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.2) * 0.5);
    p.userData = { vx: (Math.random() - 0.5) * 2.2, vy: 2 + Math.random() * 2.2, vz: (Math.random() - 0.2) * 1.2, life: 1.6 + Math.random() * 0.8, age: 0 };
    parts.push(p);
  }
  var clock = new THREE.Clock(), spinStart = -99, spinLen = 1.1, nextBlink = 2, blinkEnd = 0, lastSpin = 0;
  function celebrate() {
    var t = clock.getElapsedTime();
    burstUntil = t + 3.2; spinStart = t; spinLen = 1.1;
    for (var n = 0; n < 16; n++) spawn();
  }
  function talkFor(sec) { talkUntil = Math.max(talkUntil, clock.getElapsedTime() + sec); }

  function setMood(k) {
    if (!MOODS[k] || k === cur) return;
    cur = k;
    var M = MOODS[k];
    eyes.forEach(function (e, idx) {
      var kind = (k === "mystery" && idx === 1) ? "arc" : M.eye;
      e.material.map = eyeTex[kind]; e.material.needsUpdate = true;
    });
  }
  function setMouth(kind) {
    if (kind === mouthKind) return;
    mouthKind = kind;
    mouth.material.map = mouthTex[kind]; mouth.material.needsUpdate = true;
  }

  /* ---------- estado del agente ---------- */
  var seenFirst = false, lastSpike = false, seenNotice = {}, talkedId = "", wantMood = "calm";
  function onState(p) {
    var config = p.config || {};
    applyChar(config.character);
    if (DEMO) { document.documentElement.setAttribute("data-ready", "1"); return; }
    var ani = p.animo, on = !!(config.animo && config.animo.enabled && ani);
    wantMood = on && MOODS[ani.mood] ? ani.mood : "calm";
    var spike = on && !!ani.spike;
    if (spike && !lastSpike && seenFirst) celebrate();
    lastSpike = spike;
    var st = p.state || {};
    (st.notices || []).forEach(function (n) {
      if (seenNotice[n.id]) return;
      seenNotice[n.id] = 1;
      if (!seenFirst) return;
      if (n.kind === "gift") celebrate();
      if (n.speak) talkFor(Math.min(10, (n.text || "").length * 0.065 + 0.8));
    });
    var c = st.current;
    if (c && c.answer && c.id !== talkedId) {
      talkedId = c.id;
      talkFor(Math.min((c.showMs || 8000) / 1000, c.answer.length * 0.065 + 1));
    }
    seenFirst = true;
    document.documentElement.setAttribute("data-ready", "1");
  }

  // la voz real: el overlay que habla manda cuando suena y con que fuerza; si no hay ninguno, se calcula por el largo del texto
  var speechAt = 0, speechLevel = 0, hasVoice = false, mouthL = 0;
  var retry = 0, ws = null;
  function schedule() { retry = Math.min(retry + 1, 6); setTimeout(connect, 500 * retry); }
  function connect() {
    try { ws = new WebSocket("ws://localhost:" + WS_PORT); } catch (e) { schedule(); return; }
    ws.onopen = function () { retry = 0; ws.send(JSON.stringify({ channel: "agente", payload: { kind: "get-state" } })); };
    ws.onmessage = function (ev) {
      try {
        var m = JSON.parse(ev.data);
        if (m.channel !== "agente" || !m.payload) return;
        if (m.payload.kind === "speech") {
          if (m.payload.speaking) { speechAt = clock.getElapsedTime(); speechLevel = m.payload.level; }
          else { speechAt = 0; speechLevel = 0; }
          return;
        }
        if (m.payload.kind !== "state") return;
        hasVoice = (m.payload.voiceOverlays || 0) > 0;
        onState(m.payload);
      } catch (e) {}
    };
    ws.onclose = schedule;
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function size() {
    var w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight), asp = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = asp; camera.updateProjectionMatrix();
    var dist = Math.max(8.9, 7.9 / asp);
    camera.position.set(0, 1.5 + (dist - 8.9) * 0.0 + 0.6, dist);
    camera.lookAt(0, 1.5, 0);
  }
  window.addEventListener("resize", size); size();

  /* ---------- animacion ---------- */
  function lerp(a, b, k) { return a + (b - a) * k; }
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  var demoAt = 0, demoI = 0;

  function frame() {
    var dt = Math.min(clock.getDelta(), 0.05), t = clock.getElapsedTime();
    var K = Math.min(1, dt * 5);
    if (DEMO && t > demoAt) {
      demoAt = t + 6; wantMood = order[demoI % order.length]; demoI++;
      if (wantMood === "excited") celebrate();
      if (wantMood === "happy") talkFor(3);
    }
    var celebrating = burstUntil > t;
    setMood(celebrating ? "excited" : wantMood);
    var M = MOODS[cur], mot = reduce ? 0.35 : 1;
    var live = speechAt > 0 && t - speechAt < 0.7;
    var talking = hasVoice ? live : talkUntil > t;
    ["hop", "hopS", "breath", "tail", "tilt", "talk", "orb", "size", "blush"].forEach(function (k) { P[k] = lerp(P[k], M[k], K); });
    ["R", "L"].forEach(function (a) { ["rz", "amp", "sp", "rx"].forEach(function (k) { P[a][k] = lerp(P[a][k], M[a][k], K); }); });

    var ph = t * P.hopS, hopY = Math.abs(Math.sin(ph)) * P.hop * mot;
    root.position.y = hopY;
    body.scale.set(P.size, P.size * (1 + Math.sin(t * 1.8) * P.breath), P.size);
    if (!reduce && (M.spinEvery && t - lastSpin > M.spinEvery)) { lastSpin = t; spinStart = t; spinLen = 1.0; }
    var sp = (t - spinStart) / spinLen;
    root.rotation.y = (sp >= 0 && sp <= 1) ? ease(sp) * Math.PI * 2 : 0;
    armR.rotation.set(P.R.rx, 0, P.R.rz + Math.sin(t * P.R.sp) * P.R.amp);
    armL.rotation.set(P.L.rx, 0, P.L.rz + Math.sin(t * P.L.sp + 1) * P.L.amp);
    head.rotation.z = P.tilt * Math.sin(t * 0.9) + P.tilt * 0.6;
    head.rotation.x = Math.sin(t * 1.3) * 0.03 + (cur === "mystery" ? 0.08 : 0) + (talking && !reduce ? Math.sin(t * 7) * 0.025 + mouthL * 0.03 : 0);
    var lag = Math.cos(ph) * P.hop * 0.8;
    scarf.forEach(function (sgm, n) {
      sgm.rotation.x = Math.sin(t * 3.2 - n * 0.8) * (0.1 + P.tail * 0.55) - lag * 0.4 + 0.12;
      sgm.rotation.z = Math.sin(t * 2.1 - n * 0.6) * (0.05 + P.tail * 0.3);
    });
    bandTails.forEach(function (pv, n) {
      pv.rotation.x = 0.25 + Math.sin(t * 3 + n) * (0.08 + P.tail * 0.4) - lag * 0.3;
      pv.rotation.z = pv.userData.side * (0.1 + Math.sin(t * 2.4 + n * 2) * P.tail * 0.25);
    });
    gold.emissiveIntensity = 0.6 + P.orb * 0.6;
    if (t > nextBlink) { blinkEnd = t + 0.12; nextBlink = t + 2.5 + Math.random() * 3; }
    var open = !(t < blinkEnd);
    eyes.forEach(function (e, idx) {
      var arc = (cur === "mystery" && idx === 1);
      e.scale.y = (open || arc) ? 1 : 0.1;
      e.userData.blush.material.opacity = P.blush;
    });
    // boca: sigue la voz real (volumen); sin dato, un vaiven. Callada, queda como pide el animo.
    var lvl = !talking ? 0 : (hasVoice && speechLevel >= 0 ? speechLevel : 0.3 + 0.55 * Math.abs(Math.sin(t * 10)));
    mouthL += (lvl - mouthL) * Math.min(1, dt * 18);
    if (talking || mouthL > 0.06) {
      setMouth(mouthL > 0.08 ? "open" : (M.mouth === "o" ? "o" : "smile"));
      mouth.scale.y = 0.3 + mouthL * 1.6;
      mouth.scale.x = 1 + mouthL * 0.5;
    } else { setMouth(M.mouth); mouth.scale.y = 1; mouth.scale.x = 1; }
    turn.rotation.y = Math.sin(t * 0.35) * 0.18 * mot;
    orbs.forEach(function (o, n) {
      var u = o.userData, a = t * (0.6 + P.orb * 0.5) + u.ph;
      o.position.set(Math.cos(a) * u.r, u.h + Math.sin(t * 1.4 + n) * 0.08, Math.sin(a) * u.r);
      o.rotation.y = Math.sin(t * 1.5 + n) * 0.6; o.scale.setScalar(0.45 + P.orb * 0.3);
    });
    for (var q = parts.length - 1; q >= 0; q--) {
      var p = parts[q], d = p.userData;
      d.age += dt; d.vy -= 5 * dt;
      p.position.x += d.vx * dt; p.position.y += d.vy * dt; p.position.z += d.vz * dt; p.rotation.y += dt * 6;
      if (d.age > d.life) { turn.remove(p); parts.splice(q, 1); }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  setMood("calm"); setMouth("smile");
  applyChar({});
  connect();
  requestAnimationFrame(frame);

})();
`;

export function personajePage(wsPort: number, opts: { demo?: boolean; mute?: boolean } = {}): string {
  const js = PERSONAJE_JS.replace("__WS_PORT__", String(Math.trunc(wsPort))).replace("__DEMO__", opts.demo ? "true" : "false");
  // `mute` = vista previa dentro de la app: un recuadro fijo que se puede medir (el overlay real llena la fuente del LIVE)
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreamTok overlay personaje</title>
<style>${PERSONAJE_CSS}</style>
</head>
<body>
<div id="root"${opts.mute ? ' data-fixed="1"' : ""}><div id="stage"></div></div>
<script src="${THREE_CDN}"></script>
<script>${js}</script>
</body></html>`;
}
