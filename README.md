# StreamTok

App de escritorio (Tauri v2 + React) que conecta el LIVE de TikTok del
streamer y traduce sus interacciones (regalos, likes, follows, comentarios,
suscripciones) en acciones dentro de un mod de un juego externo — GTA V
primero — vía WebSocket. Monorepo pnpm + Turborepo.
```
packages/shared/ esquemas Zod — fuente de verdad de todos los contratos
packages/sidecar/ servidor WS Node (:7331) — habla el protocolo del mod,
conecta con TikTok LIVE, y hace el mapeo evento→acción
apps/desktop/ Tauri v2 + React — la UI, el instalador del mod
docs/adr/ Architecture Decision Records (decisiones de diseño)
```
## Stack

- **Monorepo**: pnpm workspaces + Turborepo (`turbo.json`)
- **Contratos**: TypeScript + [Zod](https://zod.dev) (`packages/shared`) — la
  fuente de verdad de todo lo que viaja por WebSocket
- **Sidecar**: Node + [`ws`](https://github.com/websockets/ws) (servidor WS
  genérico pub/sub) + [`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector)
  (conexión real al LIVE) + [`vitest`](https://vitest.dev) (tests)
- **Desktop**: [Tauri v2](https://v2.tauri.app) (Rust, solo compila en
  Windows nativo — usa la crate `windows` para desbloquear el DLL del mod)
  + React + Vite
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) — typecheck + vitest en
  `ubuntu-latest`, `cargo check` del lado Rust en `windows-latest`

## Cómo correrlo

Sin Windows ni el mod real — para ver y usar toda la UI contra el sidecar:

```bash
pnpm install
pnpm sidecar                              # terminal 1: ws://localhost:7331
pnpm --filter @streamtok/desktop dev      # terminal 2: http://localhost:5173
```

Con la app de escritorio real (botón de instalar mod, mod de GTA V conectado)
— requiere Windows nativo + Rust + WebView2:

```bash
pnpm desktop     # pnpm tauri dev
```

Para conectar tu LIVE real de TikTok en vez de solo el Simulador: abre la app,
ve a **Inicio**, escribe el usuario (con o sin `@`) y pulsa **Conectar** (el
sidecar debe estar corriendo; con `pnpm desktop` ya lo está). Debes estar en
vivo en TikTok. Alternativa sin UI: `TIKTOK_USERNAME=tu_usuario pnpm sidecar`.

### Grabación de los eventos crudos del LIVE

Cada vez que te conectas, el sidecar guarda **todo** lo que llega del LIVE, sin
filtrar (incluye lo que la app todavía no usa: niveles, donadores, batallas,
ranking, likes…), en un archivo aparte del catálogo de regalos. Sirve para
conectarte a cualquier LIVE — por ejemplo uno de batallas, con muchas
donaciones — y recopilar datos reales para decidir después qué se agrega a la app.

- Un archivo `.jsonl` por conexión en la carpeta `recordings/` de los datos de
  la app. La ruta y el contador de mensajes se ven en **Inicio** mientras
  estás conectado. Cada línea es
  `{ "t": <ms>, "type": "WebcastGiftMessage", "event": { … } }` con el mensaje
  decodificado completo.
- Para que el archivo no crezca sin control, se **compacta**: se quitan formatos
  de texto y listas repetidas de URLs de avatar; el primer like/join de cada
  viewer va completo (y de nuevo si cambian sus insignias o nivel) y los
  repetidos quedan como una línea mínima con `"ref": "viewer-seen"` (userId,
  count y total de likes); en comentarios, regalos y follows el bloque `user`
  (insignias, nivel) se guarda completo la primera vez por viewer y luego queda
  como `{ "id", "nickname", "seen": true }` (si cambia su nivel o insignias, se
  vuelve a guardar completo); las copias del mismo usuario dentro del texto a
  mostrar quedan como `{ "id", "sameAsUser": true }`; los estados que se reenvían iguales (ranking de la
  sala, batalla, panel de regalos, meta) solo se guardan si cambian
  (`"ref": "state-unchanged"`). El mensaje en sí (texto del comentario, regalo, etc.) y
  cualquier tipo desconocido se guardan siempre completos. Con `STREAMTOK_RECORD_FULL=1` se
  guarda absolutamente todo sin compactar.
- Se cierra al pulsar **Desconectar**, al terminar el LIVE o al cerrar el sidecar.
- Tope por archivo: 500 MB por defecto (al llegar deja de grabar y avisa en el
  log del sidecar); cámbialo con la variable `STREAMTOK_RECORD_MAX_MB`. Un LIVE
  de batallas puede generar varios GB por hora.
- Los mensajes incluyen datos públicos de los viewers (handles, nombres, ids,
  avatares): el archivo queda solo en tu máquina, no lo subas al repo.
- Mientras estás conectado, los eventos del LIVE también llegan a tus Eventos
  configurados: usa un perfil vacío o deja el juego cerrado si solo quieres grabar.

## Protocolo con el mod (fijo, no se negocia sin ADR)

El comportamiento del mod está descrito en un contrato externo al repo (no
hay copia local — ver Regla #1 de `AGENTS.md`). Lo que ya está decidido:

- La app es el **servidor** WS en `ws://localhost:7331`; el mod es cliente y
  se reconecta solo.
- Canales del protocolo del mod: `mod-hello` (mod→app, catálogo de
  acciones), `mod-command` (app→mod), `mod-ack` (mod→app).
- `nameTag` es siempre el **display name** del viewer, nunca el `@username`.
- Toda acción `arena_*` recibe `nameTag` y `coins` siempre.
- El mod descarta comandos si su cola local supera 300 — la app no debe
  seguir acumulando comandos sin ack más allá de ese límite.

Canales adicionales, propios de la app (UI↔sidecar, fuera del contrato del
mod, viven en sus propios archivos de `packages/shared`, nunca en
`mod-protocol.ts`):

| Canal | Qué hace |
|---|---|
| `manual-command` | Botón "Probar acción" — ejecuta una acción del catálogo a mano |
| `profiles` | Perfiles de configuración por mod (crear/duplicar/renombrar/borrar/activar) |
| `acciones` | Acciones (qué pasa) del perfil activo — ADR 0004 |
| `eventos` | Eventos (qué lo dispara) del perfil activo — ADR 0004 |
| `event-log` | Log en vivo (no persistente) de qué disparó o descartó el motor y por qué |
| `tiktok-connection` | Conectar/desconectar el LIVE de TikTok desde Inicio + estado y grabación |

## Qué ya funciona

- **Conexión real a TikTok LIVE** (`tiktok-live-connector`), normalizando
  gift/like/follow/share/comment/subscribe a `LiveEvent`, con manejo de
  rachas de regalos (aplica el efecto solo al cerrar la racha)
- **Motor genérico de Acciones y Eventos** (ADR 0004,
  `packages/sidecar/src/acciones-eventos-engine.ts`) que evalúa los Eventos
  activos del perfil activo contra cada `LiveEvent`, dispara las Acciones
  referenciadas (con `modoDisparo` todas/unaAlAzar y umbral "cada N likes"),
  fuerza `nameTag`+`coins` donde el contrato lo exige, y emite un log de cada
  decisión (disparado o descartado, con el motivo real: sin evento, mod no
  conectado, cola llena, timeout de ack, regalo en racha, umbral de likes no
  alcanzado, acción borrada)
- **Migración sin pérdida** desde instalaciones anteriores (`MappingRule` y
  `CommunityRule` → Acciones/Eventos), idempotente y cubierta por tests
- **Perfiles de configuración por mod** — varios perfiles nombrados, cada
  uno con sus propias acciones/eventos, solo uno activo a la vez
- **Panel "Eventos y Cola"** — log en vivo (in-memory, últimas 50 entradas,
  no persistente) de lo que el motor decidió por cada evento
- **Editor de parámetros tipado** (`ParamEditor`) — enum→select, bool→switch,
  int→número con presets y min/max — reutilizado en todos los flujos que
  configuran una acción
- **Instalador del mod** (`apps/desktop/src-tauri`): detecta la carpeta del
  juego (Steam vía `libraryfolders.vdf`, Epic vía manifiestos `.item`,
  Rockstar Games Launcher), verifica ScriptHookV/ScriptHookVDotNet sin
  redistribuirlos (da el link oficial si faltan), descarga la última Release
  del mod desde GitHub, la desbloquea (borra el ADS `Zone.Identifier` de
  Windows) y la instala

## Qué falta

- **Prueba real en Windows** (issue #1, abierta a propósito): CI ya valida
  `cargo check` en `windows-latest`, pero falta correr `pnpm tauri dev` +
  GTA V de verdad en una máquina Windows
- **Catálogo real de regalos**: hoy el wizard identifica un regalo solo por
  `giftId` numérico (input de texto) — falta conectar `fetchAvailableGifts()`
  de `tiktok-live-connector` para un selector visual con nombre/imagen
- **Biblioteca de Mods** (pantalla con grid de mods instalados/no
  instalados) — hoy la app asume un solo mod activo
- **Overlay server** — servir una URL local para pegar como fuente en OBS /
  TikTok LIVE Studio
- **UI de Acciones y Eventos**: el motor genérico (ADR 0004) ya existe, pero
  la UI nueva para crear/editar Acciones y Eventos es un issue futuro (se
  retiraron los paneles viejos de reglas de mapeo/comunidad)
- **Acciones generales** (alertas, TTS, animaciones, webhooks, RCON, OBS,
  keystrokes) — los `comandos` hoy solo despachan comandos del mod de GTA V;
  el resto de tipos de acción queda para el final
- Sin pasada de diseño visual dedicada — v1 es de uso personal; si hay
  clientes de pago más adelante, se rediseña el frontend reusando el mismo
  backend/sidecar como módulo

## Arquitectura de decisiones (ADRs)

- [`0001`](docs/adr/0001-persistencia-reglas-de-mapeo.md) — el sidecar es
  dueño de la persistencia de las reglas de mapeo (JSON plano en app-data),
  sin plugins de Tauri
- [`0002`](docs/adr/0002-perfiles-configuracion.md) — un solo
  `profiles.json` con todos los perfiles + perfil activo; `mapping-rules`
  pasa a operar implícitamente sobre el perfil activo
- [`0003`](docs/adr/0003-reglas-comunidad.md) — Reglas de Comunidad como
  concepto propio (no reutiliza `MappingRule`), scoped al perfil activo
  (superseded por 0004)
- [`0004`](docs/adr/0004-motor-generico-acciones-eventos.md) — motor genérico
  de Acciones y Eventos que reemplaza a `MappingRule` y `CommunityRule`, con
  migración sin pérdida de datos
- [`0005`](docs/adr/0005-metadata-liveevent-ampliada.md) — metadata de viewer
  en `LiveEvent` (`seguidor`/`suscriptor`/`moderador`/`donanteTop` y
  `emoteSuscriptor`/`stickerFanClub`) y qué queda sin implementar por límites
  de `tiktok-live-connector`

## Desarrollo

Este repo sigue un flujo estricto de issue → implementación → PR, descrito
en detalle en [`AGENTS.md`](AGENTS.md) (léelo primero si vas a tocar código
o vas a usar un agente de IA aquí): contract-first (el protocolo del mod
nunca se edita para acomodar código), TDD acotado a `packages/shared` y
`packages/sidecar` (no en la UI de React), un ADR antes de decisiones caras
de revertir, y una rama por issue (`issue-<número>-<slug>`).

```bash
pnpm install
pnpm --filter @streamtok/shared exec tsc --noEmit -p .
pnpm --filter @streamtok/sidecar exec tsc --noEmit -p .
pnpm --filter @streamtok/sidecar test
pnpm --filter @streamtok/desktop exec tsc -p tsconfig.json --noEmit
```
