# 0002. Perfiles de configuración de reglas de mapeo

- Estado: accepted
- Fecha: 2026-09-26
- Issue: #13

## Contexto

Hoy el sidecar persiste exactamente un conjunto de reglas de mapeo por
instalación (`mapping-rules.json`, un JSON array plano de `MappingRule`),
gestionado por `MappingRulesStore`/`MappingRulesController` (ADR 0001), y el
`MappingEngine` siempre corre contra ese único conjunto.

El design spec pide "perfiles": un mod puede tener varios perfiles nombrados
(por ej. "GTA Chaos Diario" vs "GTA Eventos Sábados"), cada uno con su propio
conjunto de reglas, y solo uno activo a la vez. Las reglas del perfil activo
son las que `MappingEngine` evalúa.

Esto es caro de revertir porque cambia el formato persistido en disco (hay que
migrar instalaciones existentes sin perder reglas) y el contrato shared/WS
(nuevos tipos y un canal nuevo), y decide quién es dueño de "qué reglas están
activas" en runtime.

Estado actual relevante:

- El sidecar es dueño del archivo `mapping-rules.json` (JSON array plano).
- `MappingRulesController` (ADR 0001) carga al arranque, valida contra el
  catálogo del mod-hello, persiste y hace broadcast del canal `mapping-rules`
  (`set`/`update`/`error`).
- `MappingEngine.setRules/getRules` reciben/devuelven un único array.
- La UI (MappingRulesPanel) edita las reglas por `mapping-rules` y las
  escucha por el mismo canal; no conoce el concepto de perfil.
- Precedente de canales UI↔sidecar: `mapping-rules` (request/broadcast) y
  `manual-command` (request/response), ambos en archivos propios de shared,
  nunca en `mod-protocol.ts`.

## Opciones consideradas

### 1. Un solo archivo `profiles.json` con todos los perfiles + `activeProfileId`

`{ "profiles": [{ "id", "name", "rules": MappingRule[] }], "activeProfileId": string }`.

- **Pros**: un único dueño y un único archivo (consistente con ADR 0001);
  escritura atómica; cargar todo de una vez; migración trivial (el array plano
  viejo se envuelve en un perfil); no hay que indexar un directorio.
- **Contras**: si los perfiles crecieran mucho (poco probable: reglas de chat)
  habría que releer todo, pero a esta escala es irrelevante.

### 2. Un archivo por perfil (directorio `profiles/`)

`profiles/<id>.json` + un índice que apunta al activo.

- **Pros**: cada perfil es un archivo chico y aislado.
- **Contras**: más estados (índice + N archivos), riesgo de inconsistencia
  entre índice y archivos, y la migración/arranque se complica sin beneficio
  real para una app de un solo usuario y pocos perfiles.

### 3. Dos fuentes (perfiles en disco + reglas planas aparte)

Mantener `mapping-rules.json` para "las reglas activas" y un índice de
perfiles que referencie reglas. Se descarta: reintroduce el split-brain que
ADR 0001 justamente evitó.

## Decisión

**Opción 1**: un solo archivo `profiles.json` en el app-data del sidecar
(mismo directorio que `mapping-rules.json`), con la forma
`{ profiles: [{id,name,rules}], activeProfileId }`. El sidecar sigue siendo el
único dueño del disco y del runtime (igual que ADR 0001).

**Migración**: en el primer arranque tras este cambio, si `profiles.json` no
existe pero sí `mapping-rules.json` (array plano), ese array se envuelve en un
único perfil "Predeterminado" marcado activo — **sin perder ni descartar
ninguna regla**. Si no existe ninguno (instalación fresca), se arranca con un
único perfil "Predeterminado" vacío y activo. La migración se materializa en
disco inmediatamente (se escribe `profiles.json`), para no volver a migrar en
cada arranque.

**Contrato shared nuevo** (`packages/shared/src/profile.ts`, concepto
UI↔sidecar, NO en `mod-protocol.ts`):

- `ProfileSchema` = `{ id, name, rules: MappingRule[] }`.
- `ProfilesFileSchema` = `{ profiles: Profile[], activeProfileId }` (forma en
  disco).
- `ProfileSummarySchema` = `{ id, name, ruleCount }` (lo que viaja por WS;
  las reglas no se duplican en el broadcast porque ya viajan por
  `mapping-rules`).
- `ProfilesMessageSchema` (discriminated union del canal `profiles`).

**Canal WS nuevo `profiles`** (request/broadcast, como `mapping-rules`):

- Requests (UI→sidecar): `create {name}`, `duplicate {id}`, `rename {id,name}`,
  `delete {id}`, `set-active {id}`.
- Responses (sidecar→UI): `state {profiles: ProfileSummary[], activeProfileId}`
  (broadcast en cada cambio y a clientes que conectan tarde) y `error
  {message}` (solo al socket que pidió, para rechazos).

**`mapping-rules` y el `MappingEngine`**: `mapping-rules` pasa a operar
**implícitamente sobre el perfil activo** — el cliente NO especifica perfil en
ese canal. `set` valida/persiste las reglas del perfil activo; `update` sigue
broadcasteando "las reglas del perfil activo". Cuando cambia el perfil activo,
el sidecar re-broadcastea `mapping-rules` `update` con las reglas del nuevo
activo, de modo que MappingRulesPanel se actualiza sin cambios.

**Estructura del sidecar**: un único `ProfilesController` (nuevo
`profiles.ts`) reemplaza a `MappingRulesController` y es dueño de ambos canales
(`profiles` y `mapping-rules`) y del `MappingEngine`. `validateRules` y
`appDataDir` se conservan en `mapping-rules.ts`.

## Consecuencias

- La fuente de verdad de perfiles + reglas queda en el sidecar (memoria +
  `profiles.json`). La UI espeja el estado por `profiles` `state` (metadatos) y
  `mapping-rules` `update` (reglas del activo).
- Siempre existe al menos un perfil: no se puede borrar el último (el
  controller lo rechaza con `error`). Al borrar el perfil activo, el activo
  pasa a otro perfil restante y se re-broadcastean reglas.
- Se acepta: el nombre del perfil es un string libre (sin restricción de
  unicidad; el id es el identificador estable).
- El archivo viejo `mapping-rules.json` deja de usarse; tras migrar, queda en
  disco (no se borra) por si se quiere auditar, pero ya no se lee.
