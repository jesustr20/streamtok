
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

Para conectar tu LIVE real de TikTok en vez de solo el Simulador:

```bash
TIKTOK_USERNAME=tu_usuario pnpm sidecar
```

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
| `mapping-rules` | Reglas evento→acción (Regalos y Eventos), scoped al perfil activo |
| `profiles` | Perfiles de configuración por mod (crear/duplicar/renombrar/borrar/activar) |
| `community-rules` | Las 4 reglas fijas de comunidad (Seguir/Compartir/SuperFan/Likes) |
| `event-log` | Log en vivo (no persistente) de qué disparó o descartó el motor y por qué |

## Qué ya funciona

- **Conexión real a TikTok LIVE** (`tiktok-live-connector`), normalizando
  gift/like/follow/share/comment/subscribe a `LiveEvent`, con manejo de
  rachas de regalos (aplica el efecto solo al cerrar la racha)
- **Motor de mapeo evento→acción** (`MappingEngine`, `packages/sidecar/src/mapping.ts`)
  que evalúa mapping-rules y community-rules, fuerza `nameTag`+`coins` donde
  el contrato lo exige, y emite un log de cada decisión (disparado o
  descartado, con el motivo real: sin regla, mod no conectado, cola llena,
  timeout de ack, regalo en racha, umbral de likes no alcanzado)
- **Wizard de 3 pasos** para crear/editar reglas de mapeo (evento → acción
  del catálogo del mod → parámetros tipados), reemplazando el editor de JSON
  crudo inicial
- **Perfiles de configuración por mod** — varios perfiles nombrados, cada
  uno con sus propias reglas, solo uno activo a la vez; migración automática
  y sin pérdida de datos desde instalaciones anteriores a esta feature
- **Reglas de Comunidad** — 4 slots fijos (Seguir, Compartir, SuperFan,
  Likes) siempre presentes, cada uno con su acción asignada y un
  habilitado/deshabilitado; Likes con un umbral configurable ("cada N
  likes")
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
- **Motor de Acciones y Eventos generales** (alertas, TTS, animaciones,
  webhooks, RCON, OBS, keystrokes) — el subsistema más grande pendiente,
  deliberadamente dejado para el final
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
EOF

git add README.md
git commit -m "docs: actualizar README con el estado real del proyecto (stack, canales WS, features, pendientes)"
git push -u origin docs-readme-actualizado

gh pr create \
  --title "docs: actualizar README con el estado real del proyecto" \
  --body "El README seguía describiendo el scaffold inicial (\"falta conectar tiktok-live-connector\", \"falta persistir reglas\", etc.) — todo eso ya está hecho. Actualizado con: stack completo, tabla de canales WS propios de la app, cómo correr el proyecto (con y sin Windows), qué ya funciona (issues #2 al #17), qué falta, y enlaces a los 3 ADRs."