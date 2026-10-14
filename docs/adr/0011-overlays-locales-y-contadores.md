# 0011. Overlays locales y motor de contadores (Timer y Wins)

- Estado: accepted (respuestas de Jesús el 2026-10-14; ver "Preguntas resueltas")
- Fecha: 2026-10-14
- Issue: —

## Contexto

Queremos overlays al estilo TikFinity / Interactive: páginas web que el streamer
pega en TikTok LIVE Studio (fuente "Enlace") u OBS (Browser Source) y que se
actualizan solas con lo que pasa en el LIVE. Se empieza por dos: **Timer** y
**Contador de Wins**. Más adelante vendrán metas, tops, "últimos regalos" y un
editor de pantallas que combine varios (ADR aparte).

Es caro de revertir porque fija: (a) cómo se sirven y se enlazan los overlays,
(b) un canal nuevo sidecar → overlay, (c) un estado de contadores que se persiste
y (d) cómo los Eventos pueden cambiar ese estado. Toca `packages/shared` (contrato
UI↔sidecar) con un archivo NUEVO. **No toca `mod-protocol.ts` ni `live-event.ts`.**

### Qué comprobamos en una prueba real (2026-10-14, LIVE Studio de Jesús)

- LIVE Studio **rechaza `localhost` y `127.0.0.1`** en el campo Enlace ("Introduce
  una URL válida") y **acepta `127.0.0.1.nip.io`** (un nombre de dominio que
  resuelve a 127.0.0.1). Tampoco acepta `?` en la URL tecleada; el propio LIVE
  Studio agrega `?winName=browser_<id>` al cargar.
- El lienzo **no dibujaba la página** hasta que el servidor respondió con
  `Access-Control-Allow-Private-Network: true` (más CORS abierto). El visor del
  diálogo sí la dibujaba antes; el lienzo no. Una página `http` pública sí se
  veía, así que `http` en sí no era el problema.
- Con eso, JavaScript, `fetch`, `EventSource` (SSE) y **WebSocket a
  `ws://localhost:7331`** funcionan dentro de LIVE Studio.
- Varias ventanas piden datos a la vez (visor, lienzo, navegador).

## Opciones consideradas

### 1. Cómo se sirven los overlays
- **A. Servidor HTTP local en el sidecar (elegida).** Sin dependencias en la nube,
  funciona sin cuenta, los datos nunca salen del PC. Contra: la URL para LIVE
  Studio depende de `nip.io` (DNS público) y solo sirve si LIVE Studio/OBS corren
  en el mismo PC.
- B. Alojar las páginas en un dominio público y que se conecten al sidecar. Contra:
  hay que mantener hosting y los permisos de red local siguen aplicando.
- C. Túnel `https` (ngrok/cloudflared). Contra: cuenta, dependencia externa, latencia.

### 2. Cómo cambian los Eventos al Timer/Wins
- **A. "Acciones internas" de la app (elegida):** una Acción cuyo comando es
  interno (`modActionId` con prefijo `app.`, p. ej. `app.timer.add`, `app.wins.add`) con parámetros (segundos, N).
  Reutiliza Eventos, cooldown (ADR 0010), "repetir con combo" (ADR 0009) y el
  Simulador sin código nuevo.
- B. Un bloque aparte "Efectos" dentro del Evento. Contra: duplica filtros,
  cooldown y simulador.

### 3. Configuración "por tipo" del Timer (segundos por coin, follow, like…)
- **A. Doble vía (elegida):** valores simples por tipo evaluados directamente
  sobre cada `LiveEvent` (como TikFinity/Interactive) **y** Eventos para casos
  concretos (p. ej. regalo de 500 coins = −60 s, `!menos` = −5 s con cooldown por
  persona). La segunda es lo que ellos no ofrecen.
- B. Solo Eventos. Contra: configurar "1 coin = 3 s" exige crear reglas a mano.

## Decisión

### Servidor de overlays
- El sidecar levanta un servidor HTTP en **`127.0.0.1:7340`** (`STREAMTOK_OVERLAY_PORT`
  para cambiarlo). Solo loopback: no abre puertos a la red.
- Rutas: `/overlay/<tipo>/<id>` (p. ej. `/overlay/timer/1`, `/overlay/wins/2`). Ignora
  parámetros extra de query como `winName`.
- Responde siempre con `Access-Control-Allow-Origin: *` y
  `Access-Control-Allow-Private-Network: true`, y contesta `OPTIONS` con 204.
- La URL que la app muestra con "Copiar URL" usa **`127.0.0.1.nip.io`** (para LIVE
  Studio). Se ofrece también la versión `localhost` para OBS. Alternativa futura
  sin depender de `nip.io`: un nombre propio en el archivo `hosts` de Windows.
- La página del overlay es HTML/CSS/JS estático servido por el sidecar; se conecta
  por **WebSocket al sidecar (:7331)** y solo **lee**.

### Contrato nuevo (`packages/shared/src/overlays.ts`, archivo nuevo)
- Esquemas Zod de: configuración de cada overlay, estado de contadores y mensajes
  sidecar → overlay (`overlay-state`, `overlay-config`).
- El overlay **no puede mandar comandos** de control (iniciar/pausar, sumar). El
  control (UI de la app, Eventos) entra por el canal de la UI como hoy.
- Pendiente de revisar: validar `Origin` del WebSocket, porque cualquier página
  abierta en el navegador del streamer podría conectarse a `ws://localhost:7331`.

### Motor de contadores (sidecar)
- Un solo motor con dos tipos: **timer** y **wins**.
- **Timer:** valor inicial por defecto; comenzar, pausar, reiniciar, detener, +/−;
  tiempo máximo opcional; **piso en 0** (al llegar a 0 termina y ejecuta las
  Acciones de "al expirar", nunca negativo); segundos por coin, suscripción,
  follow, share, like y mensaje de chat (positivos o negativos, admite decimales);
  multiplicador opcional. Varios eventos casi simultáneos se aplican en orden, sin
  perder ninguno. Los combos cuentan por regalo nuevo (`repeatCount`, ADR 0009).
- **Wins:** título, **meta** (cuántos wins) y **conteo** (cuántos van), con +/−
  y reinicio. Los suma/resta el streamer o un Evento (acción interna). Que los
  dispare el mod (p. ej. una meta lograda en un juego) **requiere un canal nuevo
  en el contrato del mod: no se implementa aquí** (ver "Fuera de alcance").
- **Persistencia:** `%APPDATA%\StreamTok\overlays.json` (carpeta de configuración
  de StreamTok). El timer guarda su **hora de fin** (no los segundos restantes) y
  al reabrir la app se restaura **en pausa** si estaba corriendo.

### Acciones internas
- Un comando cuyo `modActionId` empieza por `app.` no se envía al mod: lo ejecuta
  el motor de contadores. El catálogo `APP_COMMANDS` (`packages/shared/src/overlays.ts`)
  usa la forma de `ModAction` y se mezcla con las del mod en el selector
  (`withAppCommands`). **No cambia `action.ts` ni el contrato del mod** (se
  descartó el campo de origen en `Accion` por no hacer falta).

### Diseños
- Cada tipo de overlay tiene una lista de **diseños** (plantillas HTML/CSS) que
  dibujan los mismos datos. Cambiar de diseño no toca la lógica.
- La configuración (diseño elegido, colores, fuente, tamaño) se guarda en `overlays.json` y es
  **global en la v1** (no por perfil; pasarlo a por perfil queda para después) y llega al overlay por WebSocket (canal `overlays`; los overlays solo leen), así que los cambios se ven al instante.
- Primeros diseños: Timer (estilo Interactive, estilo TikFinity) y Wins (estilo
  Interactive). Se agregan más después.

### Menú de la app
- Sección "Overlays" con submódulos por tipo; cada uno con campos, URL (Copiar,
  Probar), vista previa en vivo y lista de diseños seleccionables.

## Fuera de alcance (decisiones posteriores)
- Editor de pantallas (lienzo con varios widgets y una sola URL): ADR aparte; este
  ADR deja cada overlay renderizable solo o como widget.
- Atajos de teclado globales (Rust, solo Windows).
- Wins disparados por el mod: requiere canal nuevo en el contrato; detenerse,
  ADR y aprobación, y coordinar con el hilo del mod.
- Kick y YouTube; metas, tops, últimos regalos, sorteos; "play <canción>".
- "Retraso de la acción" (campo del modal que hoy no hace nada).

## Preguntas resueltas (Jesús, 2026-10-14)
1. **Wins: 1 solo contador** por ahora (Interactive trae 3 con submenús; se evita
   el submenú). El motor soporta N, así que se puede ampliar sin rehacer nada.
2. **Timer: doble vía** (valores simples por tipo + Eventos). Se implementa para
   probarlo y entenderlo; se mejora después.
3. **Diseños: ambos caminos.** Adaptar ideas de Interactive/TikFinity/otros (hechos
   desde cero, sin copiar código ni marca) y también diseños propios de StreamTok.

## Consecuencias

- Más fácil: sumar overlays nuevos (solo diseño + datos), reutilizar Eventos,
  cooldown y Simulador para cambiar contadores, y componerlos luego en un editor.
- Más difícil / deuda aceptada: la URL para LIVE Studio depende de `nip.io` y de
  internet; el servidor local debe aguantar varias ventanas a la vez; un puerto
  más que puede chocar con otro programa (por eso es configurable); riesgo de
  páginas web externas conectándose al WebSocket (mitigación pendiente: `Origin`).
- Aprendizaje de la prueba: las fuentes de enlace de LIVE Studio con direcciones
  locales exigen las cabeceras de red privada; no es opcional.
