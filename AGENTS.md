# AGENTS.md — harness para DeepSeek (u otro agente de código) en este repo

Este archivo es lo primero que debe leer cualquier agente de IA antes de tocar
código en este repo. Si algo en un prompt de issue contradice este archivo,
**este archivo gana** — pregunta antes de proceder.

## Qué es este proyecto

**StreamTok**: app de escritorio (Tauri v2 + React) que conecta un LIVE de
TikTok y le manda acciones a mods de juegos externos (GTA V primero) vía
WebSocket. Monorepo pnpm + Turborepo:

```
packages/shared/    esquemas Zod — la fuente de verdad de todos los contratos
packages/sidecar/   servidor WS Node (:7331) — habla el protocolo del mod y
                     hace el mapeo evento de TikTok → comando del mod
apps/desktop/       Tauri v2 + React — UI, botón de instalar el mod
docs/adr/           Architecture Decision Records
```

## Regla #1 — Contract-first, nunca al revés

El comportamiento real del mod de GTA V está descrito en un documento de
contrato (fuera de este repo, en el proyecto de Claude: **no lo edites nunca,
no existe copia local**). `packages/shared/src/mod-protocol.ts` es la
traducción de ese contrato a tipos TypeScript/Zod.

**Si tu tarea parece requerir cambiar un campo, tipo o canal en
`mod-protocol.ts` o `live-event.ts`, DETENTE y pregunta primero.** No lo
cambies para que "calce" con lo que estás implementando — el contrato manda,
el código se ajusta a él, nunca al revés. Un campo que no existe en el
contrato no se inventa, aunque parezca útil.

Reglas del protocolo que YA están decididas y no se negocian sin ADR:
- La app es el **servidor** WS en `ws://localhost:7331`; el mod es cliente y
  se reconecta solo.
- Canales: `mod-hello` (mod→app, catálogo), `mod-command` (app→mod),
  `mod-ack` (mod→app).
- `nameTag` es el **display name** del viewer, nunca el `@username`.
- Toda acción `arena_*` recibe `nameTag` y `coins` siempre.
- El mod descarta comandos si la cola local supera 300 — la app no debe
  seguir acumulando comandos sin ack más allá de ese límite.

## Regla #2 — Usa el grafo, no leas archivo por archivo

Este repo tiene `codebase-memory-mcp` configurado. Antes de explorar con
`grep`/`read` a ciegas:

```bash
codebase-memory-mcp cli index_repository --repo-path .
codebase-memory-mcp cli get_architecture --project streamtok
codebase-memory-mcp cli search_graph --project streamtok --name-pattern '<algo>'
codebase-memory-mcp cli trace_path --project streamtok --function-name <fn> --direction both
```

Si el proyecto ya está indexado (revisa con `list_projects`), no lo
reindexes en cada sesión. Usa `get_code_snippet` en vez de abrir un archivo
completo cuando solo necesitas una función o tipo.

## Regla #3 — TDD en `shared` y `sidecar`, no en la UI

- `packages/shared` y `packages/sidecar`: **escribe o actualiza un test
  (`vitest`) junto con cualquier cambio de lógica**, especialmente en
  `mod-bridge.ts` y `mapping.ts`. `pnpm --filter @streamtok/sidecar test`
  debe pasar antes de dar por terminado un issue.
- `apps/desktop` (React/UI): no se exige TDD — es exploratorio y cambia
  seguido con feedback visual. Sí debe pasar `pnpm typecheck`.
- El Rust de `apps/desktop/src-tauri` es **Windows-only** (usa la crate
  `windows` para el unblock del DLL). No lo compiles desde WSL/Linux —
  hazlo en Windows nativo con `pnpm tauri dev`/`build`. `cargo check` en
  Linux solo valida la parte no-Windows y sirve como chequeo rápido, no
  como validación final.

## Regla #4 — Definición de "terminado" por issue

Antes de abrir el PR:
```bash
pnpm install
pnpm --filter @streamtok/shared exec tsc --noEmit -p .
pnpm --filter @streamtok/sidecar exec tsc --noEmit -p .
pnpm --filter @streamtok/sidecar test
pnpm --filter @streamtok/desktop exec tsc -p tsconfig.json --noEmit
```
Todo debe pasar en limpio. Si algo de esto no aplica a tu issue, dilo en el
PR en vez de omitirlo en silencio.

## Regla #5 — Decisiones caras de revertir → ADR, no código directo

Si tu tarea implica elegir entre dos formas de resolver algo y una es difícil
de deshacer después (ej. cómo se persisten las reglas de mapeo, cómo se
autentica el desktop contra el backend en v2), escribe un ADR primero:

```bash
codebase-memory-mcp cli manage_adr --project streamtok --action create \
  --title "..." --status proposed
```
o, si no está disponible, un archivo en `docs/adr/NNNN-titulo.md` (ver
`docs/adr/0000-template.md`). Para un cambio tipo CRUD normal, no hace falta
— ve directo a implementar.

## Regla #6 — Git / PRs

- Una rama por issue: `issue-<número>-<slug>`.
- Commits descriptivos, en español o inglés, consistentes con el resto del
  repo.
- El PR referencia el issue (`Closes #N`) y resume qué se hizo y qué falta
  (si algo queda pendiente, dilo explícito, no lo escondas).
- No hagas `git push --force` a `main`, no saltes hooks.

## Qué NO hacer

- No reescribas `packages/shared` "para que se vea mejor" — es el contrato,
  cambios ahí necesitan ADR + aprobación explícita.
- No agregues dependencias nuevas sin decirlo en el PR.
- No asumas que ScriptHookV/ScriptHookVDotNet se pueden empaquetar o
  redistribuir — el contrato prohíbe esto explícitamente.
- No inventes campos, canales o comportamiento del protocolo que no esté en
  `mod-protocol.ts` ni en el contrato original.
