# 0003. Reglas de comunidad

- Estado: superseded by 0004
- Fecha: 2026-09-27
- Issue: #15

## Contexto

El design spec pide una sección "Reglas de Comunidad" en la pantalla de detalle
del mod, distinta de "Regalos y Eventos" (las reglas de mapeo, una lista abierta
que el usuario agrega/borra). Reglas de Comunidad es un panel de **exactamente 4
filas fijas** que siempre existen y solo se configuran, nunca se crean ni se
borran:

- Seguir (Follow)
- Compartir (Share)
- SuperFan (un concepto de suscripción de TikTok)
- Likes

Cada fila tiene: una acción asignada del catálogo del mod (con sus params, igual
que en el resto de la app) y un toggle para habilitar/deshabilitar esa fila de
forma independiente. La fila "Likes" además tiene un umbral numérico ("cada N
likes" — la acción se dispara cada N likes, no en cada like individual). Para las
otras tres filas no hay un concepto de "cantidad" con sentido: un evento de
follow/share/superfan simplemente dispara o no la acción asignada.

Debe estar acotado al perfil activo (issue #13): cambiar de perfil cambia qué
configuración de reglas de comunidad está vigente, igual que ya ocurre con las
reglas de mapeo.

Es caro de revertir porque define (a) el contrato shared/WS (tipos + canal
nuevo), (b) la forma persistida en `profiles.json` (hay que migrar perfiles
existentes sin perder datos) y (c) el modelo de ejecución en runtime (un umbral
"cada N likes" requiere un contador con estado, algo que hoy no existe en el
motor de mapeo).

### Qué soporta hoy `MappingRule`

`MappingRule.when` (packages/shared/src/mapping-rule.ts) es un objeto plano:

```ts
when: { event: LiveEventType, giftId?: number, minCoins?: number, command?: string }
```

`LiveEventType` (packages/shared/src/live-event.ts) es un enum que **ya
distingue individualmente** `follow`, `share`, `subscribe` y `like` (además de
`gift`, `comment`, `join`). Es decir: el esquema subyacente sí modela cada uno de
estos eventos como un valor propio de `event`; no es un bucket genérico "otro".
Los únicos filtros específicos de evento que existen hoy son `giftId`/`minCoins`
(solo `gift`) y `command` (solo `comment`); el resto de eventos no tienen
condición adicional.

El reporte del issue #11 describía la UI del RuleWizard como "colapsa todo lo que
no es gift/comment en un bucket genérico de 'otro evento'". Eso es una observación
de **rendering**: el wizard lista los 7 eventos con etiquetas propias, pero todo lo
que no es gift/comment comparte la misma fila "sin condición adicional". El valor
de `event` sí se preserva de forma distinta. Conclusión: el gap real para Reglas
de Comunidad **no** es "falta distinguir follow/share/subscribe" — ya se
distinguen. El gap real son dos cosas que `MappingRule` no expresa:

1. un toggle `enabled` por regla (MappingRule no tiene enable/disable, se
   crea/borra),
2. un umbral "cada N likes" con semántica de contador con estado (los filtros de
   `when` son predicados puros por evento, sin memoria entre eventos).

## Opciones consideradas

### 1. Reusar `MappingRule` para las 4 reglas de comunidad

Las 4 filas serían instancias "bien conocidas" de `MappingRule` con `when.event`
fijo (`follow`/`share`/`subscribe`/`like`) que la UI siempre muestra y nunca deja
borrar, y el controller se encarga de que esas 4 existan siempre.

- **Pros**: un solo modelo y un solo motor (`MappingEngine`); el mapeo
  evento→acción+params ya existe.
- **Contras**: hay que ensuciar `MappingRule` con un campo `enabled` que las
  reglas de mapeo no usan (la UI de mapping tendría que ignorarlo), y el umbral
  "cada N likes" no calza en `when` (que es stateless) — habría que inventar un
  campo nuevo y una semántica nueva con contador en el motor. Además la
  restricción "4 filas fijas, nunca se crean/borran" no la expresa el tipo (es un
  array abierto); quedaría como invariante informal del controller.

### 2. Concepto/schema nuevo, separado de `MappingRule`

Un `CommunityRule` propio (por slot): `{ enabled, action, params, everyNLikes? }`
en un objeto fijo de 4 claves (`follow`, `share`, `superfan`, `like`). Reusa los
primitivos existentes (la forma `action`+`params`, el enum `LiveEventType`, y la
validación de params contra el catálogo) pero no el tipo `MappingRule` en sí.

- **Pros**: las 4 filas fijas son un invariante del tipo (objeto con 4 claves,
  no array); el toggle `enabled` y el umbral `everyNLikes` viven solo donde
  aplican; no se contamina `MappingRule` ni su UI.
- **Contras**: un concepto y un canal nuevos que mantener; el motor debe evaluar
  dos fuentes (mapping rules + community rules) en vez de una.

## Decisión

**Opción 2 — concepto/schema nuevo, reusando primitivos.** Un archivo
`packages/shared/src/community-rule.ts` (concepto UI↔sidecar, **NO** en
`mod-protocol.ts`) define:

- `CommunityRuleKind = "follow" | "share" | "superfan" | "like"` (orden canónico
  para la UI) y su mapeo a `LiveEventType`: `follow`→`follow`, `share`→`share`,
  `superfan`→`subscribe`, `like`→`like`.
- `CommunityRule = { enabled, action, params, everyNLikes? }`. `action` es el
  `ModAction.id` (string vacío `""` = sin acción asignada); `params` es el mismo
  `Record<string, number|string|boolean>` que se usa en el resto; `everyNLikes`
  solo tiene sentido en el slot `like`.
- `CommunityRules = { follow, share, superfan, like }` — un objeto fijo de 4
  claves, que es lo que hace explícita la restricción "siempre 4, nunca
  crear/borrar".

Por qué no la opción 1: las diferencias no son cosméticas. `enabled` es un campo
que `MappingRule` no tiene y no debería tener (sus reglas se crean/borran, no se
habilitan); "cada N likes" es un contador con estado, no un predicado de
`when`; y las "4 filas fijas" se expresan mucho mejor como un objeto de 4 claves
que como un array abierto. Forzarlo en `MappingRule` sería exactamente el
force-fit que Regla #1 desaconseja. A la vez, no se duplica la parte que sí es
compatible: la forma `action`+`params` y la validación contra el catálogo se
reusan tal cual.

### Modelado de "cantidad" / umbral

- **Seguir / Compartir / SuperFan**: sin campo de cantidad. Son
  `enabled + action + params`, y disparan en cada evento del tipo correspondiente
  (equivale al "1" del mockup: se dispara siempre que ocurre el evento).
- **Likes**: `everyNLikes` (entero positivo, default `1` = dispara en cada like).
  El motor cuenta likes y dispara cada N. No se guarda `everyNLikes` en los otros
  tres slots.

### Persistencia y migración

Las reglas de comunidad viven **dentro de `profiles.json`**, como campo
`communityRules` de cada `Profile` (misma fuente de verdad que ADR 0002): el
sidecar sigue siendo dueño del disco y del runtime.

- `ProfileSchema` pasa a `{ id, name, rules, communityRules? }` — **opcional en
  disco**, para no romper perfiles existentes de la era issue #13.
- Migración: al cargar, todo perfil sin `communityRules` (o con el objeto
  incompleto) se completa con `defaultCommunityRules()`: los 4 slots presentes,
  `enabled: false`, `action: ""`, `params: {}`, y `everyNLikes: 1` en `like`.
  Se materializa en disco en el arranque (igual que la migración de ADR 0002).
- `duplicate` de perfil copia también `communityRules` (deep copy).

### Canal WS

Canal nuevo **`community-rules`** (mismo patrón request/broadcast que
`mapping-rules`):

- `set` (UI→sidecar): el objeto `CommunityRules` completo del perfil activo.
- `update` (sidecar→UI): el objeto vigente, broadcast en cada cambio y a clientes
  que se conectan tarde.
- `error` (sidecar→UI): rechazo de un `set` inválido.

Opera **implícitamente sobre el perfil activo** (como `mapping-rules` tras ADR
0002); el cliente no especifica perfil. Al cambiar el perfil activo, el sidecar
re-broadcastea `community-rules` `update` con la config del nuevo activo.

### Ejecución

`MappingEngine` evalúa también las reglas de comunidad (es el único punto
"evento→comando" del sidecar): se le agrega `setCommunityRules`/`getCommunityRules`
y en `handleEvent` se chequea el slot correspondiente. Para `like` mantiene un
contador (`likeCount`, reseteado en cada `setCommunityRules` y en cada cambio de
perfil activo) que dispara cada `everyNLikes`. Las reglas de mapeo y las de
comunidad son independientes: un mismo evento puede disparar ambas (no se
excluyen).

## Consecuencias

- La fuente de verdad de las reglas de comunidad queda en el sidecar (memoria +
  `profiles.json`); la UI espeja por `community-rules` `update`.
- Se valida contra el catálogo del mod-hello igual que las reglas de mapeo
  (acción existente, params definidos); un `set` inválido se rechaza con `error`
  y no toca disco ni motor.
- Se acepta: el umbral `everyNLikes` se resetea al cambiar de perfil o al recibir
  un `set` (un "cada N" a mitad de camino se pierde al reconfigurar); es un
  detalle aceptable para una app personal.
- `MappingRule`/`when`/`mod-protocol.ts` quedan intactos: no se tocan.
