# 0001. Persistencia de las reglas de mapeo

- Estado: accepted
- Fecha: 2026-09-26
- Issue: #3

## Contexto

Hoy el `MappingEngine` del sidecar arranca con una lista fija de reglas
(`initialRules` en `packages/sidecar/src/index.ts`), que solo sirve para
probar el flujo end-to-end con el Simulador. Necesitamos que el usuario pueda
crear/editar/borrar reglas de mapeo (evento de TikTok → acción del mod) desde
la UI del desktop y que esas reglas sobrevivan a reinicios de la app y del
sidecar.

El problema que obliga a decidir ahora: **dónde vive el archivo y qué proceso
es dueño de leerlo/escribirlo**. Esto es caro de revertir porque define de
quién es la fuente de verdad de la configuración del usuario, y arrastra el
protocolo WS (qué canales nuevos) y la infraestructura de archivos del
desktop (plugins/capabilities de Tauri).

Estado actual relevante:

- El **sidecar** es un proceso Node (TS, `tsx`) que ya es dueño del
  `MappingEngine`: es lo único que evalúa las reglas en runtime (`handleEvent`).
  Escucha en `ws://localhost:7331`.
- El **desktop** es Tauri v2 + React. Habla con el sidecar por WS
  (`SidecarClient`) como un cliente más. No tiene hoy ningún plugin de
  filesystem (`@tauri-apps/plugin-fs` NO está instalado); su file I/O actual
  son comandos Tauri puntuales (instalar el mod, detectar GTA V) en Rust.
- Los canales `mod-hello` / `mod-command` / `mod-ack` están **reservados al
  protocolo del mod** (Regla #1) y no deben reutilizarse para esto.

## Opciones consideradas

### 1. JSON gestionado por el sidecar (Node `fs`, sin dependencias nuevas)

El sidecar escribe/lee un `mapping-rules.json` en un directorio de app-data
por SO (`%APPDATA%/StreamTok`, `~/Library/Application Support/StreamTok`,
`$XDG_CONFIG_HOME/streamtok`). La UI manda las reglas por un canal WS nuevo
(`mapping-rules`) y recibe la lista vigente por el mismo canal.

- **Pros**: un solo dueño de la verdad (runtime + disco juntos, sin
  split-brain); cero dependencias/plugins nuevos; el sidecar recarga las
  reglas aunque el desktop esté cerrado; trivial de testear (TDD del sidecar,
  el store recibe una ruta inyectable).
- **Contras**: el archivo queda en el app-data del sidecar; si mañana se
  quiere gestionarlo desde la UI (exportar/importar, file dialogs) hay que
  mover la responsabilidad al desktop.

### 2. JSON gestionado por Tauri (plugin/command) desde el desktop

El desktop lee/escribe el archivo vía un plugin de fs o un comando Rust, y le
manda las reglas al sidecar por WS cada vez que cambian (y al arrancar).

- **Pros**: el desktop ya es la capa "de usuario"; futuros file dialogs serían
  naturales.
- **Contras**: hay que añadir `@tauri-apps/plugin-fs` (crate Rust + paquete JS
  + `capabilities`), y además introducir un protocolo de sincronización: el
  sidecar no tiene reglas hasta que el desktop conecta y las empuja, y si el
  sidecar se reinicia solo pierde las reglas hasta el próximo push. Dos dueños
  de la verdad (disco en desktop, runtime en sidecar) = más superficie de bugs.

### 3. Híbrido (sidecar persiste, desktop solo edita por WS)

Variante de la 1: el sidecar es dueño del disco y expone las reglas por WS;
la UI solo CRUD por WS. Es esencialmente la opción 1 con un canal
request/response más explícito.

- **Pros/Contras**: igual que la 1; añade un ack por mensaje sin beneficio real
  para una lista tan chica (se resuelve con `set` → `update`/`error` broadcast).

## Decisión

**Opción 1**: el **sidecar** persiste las reglas en un `mapping-rules.json`
(JSON array de `MappingRule`) en un directorio de app-data por SO, usando
`node:fs` (sin dependencias nuevas). La UI edita las reglas por un canal WS
nuevo, **`mapping-rules`** (claramente separado del protocolo del mod), con
payload discriminated union: `set` (UI→sidecar, lista completa), `update`
(sidecar→UI, lista vigente, también reenviada a clientes que se conectan
tarde) y `error` (sidecar→UI, rechazo de validación).

Por qué: el `MappingEngine` ya es el dueño en runtime; persistir junto a él
evita el split-brain de la opción 2 y no requiere tocar Tauri ni plugins. El
protocolo es de reemplazo completo de la lista (no CRUD por id), porque la
lista es chica y así no hay que inventar idempotencia/orden de mutaciones.

## Consecuencias

- La fuente de verdad de las reglas queda en el sidecar (memoria + disco). La
  UI es un editor que espeja lo que el sidecar le devuelve en `update`.
- Las reglas se validan en el sidecar contra el catálogo del mod-hello
  (acción existente, params definidos) antes de persistir; un `set` inválido
  se rechaza con `error` y no toca disco ni el `MappingEngine`.
- Aceptamos: si en el futuro se quiere exportar/importar o file dialogs
  nativos, habrá que mover la persistencia al desktop (caro, por eso se
  documenta ahora).
- El canal `mapping-rules` es nuevo y no reutiliza ningún canal del mod.
