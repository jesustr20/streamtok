# StreamTok

Monorepo (pnpm + Turborepo): `apps/desktop` (Tauri v2 + React) y `packages/sidecar` (servidor WS Node) + `packages/shared` (esquemas Zod).

Este scaffold implementa el lado **app** del contrato con el mod de GTA V v0.9.0
(`claude/mod-gtav-integracion-app.md` en el proyecto de Claude): el servidor
WebSocket en `:7331` y el botón "Instalar mod de GTA V".

## Qué ya funciona (verificado con un smoke test WS real)

- **Servidor WS en `ws://localhost:7331`** (`packages/sidecar`), servidor
  genérico de pub/sub (`ws-server.ts`) + `ModBridge` (`mod-bridge.ts`) que
  habla exactamente el protocolo del contrato:
  - `mod-hello` (mod→app): guarda el catálogo, lo cachea y lo reenvía a
    cualquier cliente (UI) que se conecte después, aunque llegue tarde.
  - `mod-command` (app→mod): genera `id`, respeta el límite de 300 en cola
    documentado por el mod (no sigue acumulando si ya se llenó), timeout de
    5s si no llega `mod-ack`.
  - `mod-ack` (mod→app): resuelve la promesa del comando y se reenvía a la
    UI por el canal `mod-ack-log` para el log.
- **Motor de mapeo evento→acción** (`mapping.ts`): reglas simples
  (evento + filtro → acción + params), ignora regalos en streak hasta
  `repeatEnd`, y **fuerza `nameTag` = display name del viewer** (nunca
  `@username`) en toda acción `arena_*` o que declare `supportsNameTag`,
  más `coins` cuando la regla lo pide (`passCoinsAsParam`) — tal como exige
  el contrato para el modo Pelea.
- **Botón "Instalar mod de GTA V"** (`apps/desktop/src-tauri`):
  1. detecta la carpeta del juego (Steam vía `libraryfolders.vdf`, Epic vía
     manifiestos `.item`, Rockstar Games Launcher) — `gta_locate.rs`
  2. si no la encuentra, la UI ofrece elegirla a mano
  3. comprueba `ScriptHookV.dll` y `ScriptHookVDotNet*`; si faltan, **no
     intenta copiarlos** (el contrato dice que no se redistribuyen) y
     devuelve el link oficial de cada uno
  4. si están, baja la última Release de `streamtok-mod-gtav` en GitHub,
     extrae `scripts\StreamTok.GtaV.dll` del zip, crea `scripts\` si no
     existe, copia la DLL y la desbloquea (borra el ADS `Zone.Identifier`)
  5. escribe `scripts\StreamTok.GtaV.ini` con defaults solo si no existía

## Qué falta (siguiente iteración)

- **Conectar `tiktok-live-connector` de verdad** en `packages/sidecar/src/index.ts`
  (hay un TODO marcado) — hoy los eventos de prueba se inyectan a mano por el
  canal `live-event` (así es como se conectará el Simulador de la UI también).
- **Persistir las reglas de mapeo** desde la UI "Acciones y Eventos" (hoy
  `initialRules` en `index.ts` son solo de ejemplo/smoke-test).
- **Editor de `params` en la UI** (enum→select, bool→switch, int→número +
  botones de `presets`) sobre `ActionsPanel.tsx`, que hoy solo lista el
  catálogo de lectura.
- Íconos reales de Tauri (`src-tauri/icons/`) — el `tauri.conf.json` los
  referencia pero no están generados.
- El código de Rust (Windows-only: `windows` crate, ADS, etc.) no se pudo
  compilar en este sandbox Linux — se validó por lectura, falta compilarlo
  en Windows con `pnpm tauri build`.

## Desarrollo

```bash
pnpm install
pnpm sidecar   # levanta ws://localhost:7331
pnpm desktop   # tauri dev (requiere Windows + Rust + WebView2 para el instalador real)
```
