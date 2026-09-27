# 0004. Motor genérico de Acciones y Eventos

- Estado: accepted
- Fecha: 2026-09-27
- Issue: #21

## Contexto

El repo tiene hoy dos mecanismos separados para decidir "qué dispara qué" al
llegar un evento del LIVE:

1. **`MappingRule`** (`packages/shared/src/mapping-rule.ts`): lista abierta de
   reglas evento→acción, editadas con un wizard de 3 pasos (`RuleWizard.tsx`) y
   evaluadas por `MappingEngine` (ADR 0001, ADR 0002).
2. **`CommunityRule`** (`packages/shared/src/community-rule.ts`): 4 slots fijos
   de comunidad (Follow/Share/SuperFan/Likes) como concepto aparte (ADR 0003).

El diseño real del producto (validado contra la referencia de UX, el patrón de
TikFinity/Interactive.io) no tiene dos mecanismos: tiene **un solo motor
genérico** con dos conceptos independientes — **Acción** (qué pasa) y **Evento**
(qué lo dispara) — donde un Evento referencia una o más Acciones por `id`. Los 4
casos de "comunidad" no son un concepto de backend aparte: son Eventos normales
con tipos de disparo específicos (`seguir`, `compartir`, `suscribirse`,
`likes`).

Esto es caro de revertir porque reemplaza el modelo de datos persistido
(`profiles.json`), el contrato shared/WS (dos canales nuevos y dos retirados) y
el motor de runtime, y obliga a una migración sin pérdida de datos de las
instalaciones existentes. Por eso requiere ADR y **reversa ADR 0003**.

## Opciones consideradas

### 1. Mantener los dos mecanismos y agregar el genérico encima

Descartado: duplica el mismo concepto tres veces (regla de mapeo, regla de
comunidad, y ahora acción/evento) y contradice el diseño validado. No hay razón
técnica para conservar los dos viejos más allá de "no tocar lo que ya funciona".

### 2. Un solo motor Acción/Evento, migrando lo existente (elegida)

Reemplazar `MappingRule` y `CommunityRule` por `Accion` + `Evento`, migrando los
datos viejos a la nueva forma. Es la opción que pide el diseño y la que deja un
solo modelo coherente.

## Decisión

**Opción 2.** Se introducen dos conceptos nuevos (ambos en `packages/shared`,
fuera de `mod-protocol.ts`):

- `Accion` (`action.ts`): `{ id, nombre, descripcion, duracionSeg, puntos,
  pantalla, media, comandos }`. `comandos` es una **lista** (una Acción agrupa
  varios comandos del mod). `puntos`/`pantalla`/`media`/`duracionSeg` se
  almacenan pero son inertes (no hay sistema de puntos ni overlay aún).
- `Evento` (`event.ts`): `{ id, activo, quien, porque, …campos condicionales,
  modoDisparo, accionesIds }`, con la matriz condicional de `porque` y `quien`
  validada con `z.superRefine`.

### Matriz de coincidencia (`quien` + `porque`)

- `quien` hoy solo puede evaluar `todos` (siempre coincide) y
  `usuarioEspecifico` (coincide por `username`/handle del `LiveEvent`).
  `seguidor`/`suscriptor`/`moderador`/`donanteTop` requieren metadata de viewer
  que `LiveEvent` aún no trae (extender `live-event.ts` está fuera de alcance),
  así que por ahora **no coinciden** y quedan a la espera de enriquecer la
  fuente de TikTok.
- `porque` se mapea a los `LiveEventType` existentes: `unirse`→`join`,
  `seguir`→`follow`, `compartir`→`share`, `suscribirse`→`subscribe`,
  `likes`→`like`, `chat`→`comment`, `comando`→`comment` (con prefijo),
  `regaloValorMinimo`→`gift` (coins ≥ umbral), `regaloEspecifico`→`gift`
  (giftId/giftName). `primeraActividad`, `emoteSuscriptor`, `stickerFanClub` y
  `compraTiktokShop` no tienen dato equivalente en `LiveEvent` hoy, así que no
  coinciden todavía (forman parte del schema, listos para cuando la fuente los
  provea).

### Primera coincidencia vs. todas las coincidencias

Se elige **disparar todas las coincidencias**: un mismo evento puede disparar
varios Eventos (p. ej. un `regalo` puede satisfacer a la vez un
`regaloValorMinimo` y un `regaloEspecifico`), igual que el motor anterior ya
disparaba reglas de mapeo y de comunidad de forma independiente. `modoDisparo`
controla, dentro de un Evento, si se ejecutan todas sus Acciones (`todas`) o una
al azar (`unaAlAzar`).

### Canales WS

- Canal nuevo **`acciones`**: `set` (lista completa) / `update` (lista vigente)
  / `error` — CRUD por reemplazo de lista, mismo patrón que `mapping-rules`.
  Scoped al perfil activo.
- Canal nuevo **`eventos`**: idéntico patrón.
- Se **retiran** `mapping-rules` y `community-rules` (no se conservan ni en
  read-only: la migración es de disco, no necesita esos canales). Los schemas
  legacy (`MappingRuleSchema`, `CommunityRulesSchema`) se conservan **solo**
  para la migración.
- `event-log` se mantiene: el motor nuevo emite las mismas decisiones (fired/
  discarded) con los mismos motivos, más uno nuevo `accion-no-encontrada` (un
  Evento referencia una Acción borrada). Los campos `ruleId`/`communityKind` de
  `EventLogEntry` se reemplazan por `eventoId`/`accionId`.

### Migración (sin pérdida, idempotente)

Al arrancar, `ProfilesStore.load()`:

1. Lee `profiles.json`; si está en la forma nueva (`acciones`/`eventos`) lo usa
   tal cual.
2. Si está en la forma vieja (`rules`/`communityRules`), convierte:
   - cada `MappingRule` → 1 `Accion` (1 comando = su `action` + `params`) + 1
     `Evento` que replica su `when` con el mejor `porque` posible;
   - cada slot de `CommunityRule` con acción asignada → 1 `Accion` + 1 `Evento`
     (Follow→`seguir`, Share→`compartir`, SuperFan→`suscribirse`, Likes→`likes`
     con `cantidadMinimaLikes` = umbral), preservando `enabled`→`activo`.
3. Si no hay `profiles.json` pero sí `mapping-rules.json` plano, lo envuelve en
   un perfil y aplica la conversión de (2).
4. Instalación fresca: perfil "Predeterminado" vacío.

La migración se materializa en disco al primer arranque y es idempotente (si ya
está en la forma nueva, no duplica). Se cubre con un test real.

### Limitaciones conocidas de la migración

- `MappingRule.passCoinsAsParam` (inyección dinámica de `coins` en un param) no
  tiene equivalente en el modelo nuevo; los `params` estáticos se conservan y
  esa inyección se pierde (documentado, aceptado).
- `MappingRule.when` con `giftId` **y** `minCoins` a la vez se migra priorizando
  `giftId` (`regaloEspecifico`); el `minCoins` se pierde.
- `cantidad`/`intervaloMs` de un comando se almacenan pero **no se ejecutan** en
  este issue (repetición con intervalo diferida).

## Consecuencias

- Un solo modelo `Accion`/`Evento`; el motor (`AccionesEventosEngine`) evalúa
  todos los Eventos activos del perfil activo contra cada `LiveEvent`.
- La fuente de verdad sigue en el sidecar (memoria + `profiles.json`); los
  canales `acciones`/`eventos` operan implícitamente sobre el perfil activo y
  re-broadcastean al cambiar de perfil y a clientes tardíos (igual que antes).
- El frontend queda **sin** los paneles viejos (`MappingRulesPanel`,
  `CommunityRulesPanel`, `RuleWizard` se retiran); la UI nueva de Acciones y
  Eventos es un issue futuro separado.
- ADR 0003 queda **superseded** por esta decisión.
