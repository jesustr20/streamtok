# 0007. Niveles de fan y de donador en `LiveEvent` y eventos de subida de nivel

- Estado: accepted (aprobado por Jesús el 2026-10-04)
- Fecha: 2026-10-04
- Issue: —

## Contexto

La pantalla "Simular Eventos" (copiada de Interactive) tiene "Simular Fan Lvl" y
"Simular Donor Lvl", y el motor tenía campos de nivel (`nivelEquipoRequerido`,
`nivelPuntosRequerido`) que nunca se evaluaban porque `LiveEvent`
(`packages/shared/src/live-event.ts`, parte del contrato) no llevaba ningún
nivel. Cambiar ese archivo exige ADR y aprobación explícita (AGENTS.md, regla 1).

Se analizaron dos grabaciones reales (una muestra de 19 mensajes y un live de
2757 líneas con 656 chats, 612 unirse, 609 likes y 112 regalos). Hallazgos:

- Los mensajes de chat, regalo, like y unirse traen `user.badgeList[]`, una
  insignia por rol, distinguidas por `sceneType`. El nivel va en
  `privilegeLogExtra.level` (string) y, en las de nivel, también en `combine.str`:
  - `sceneType 8`: **nivel de usuario de TikTok (nivel de donador)**, 1 a 35 en
    la muestra (icono `grade_badge_icon_lite_lvN`). Subió de 6 a 7 y de 5 a 6 en
    mensajes de regalo de la grabación.
  - `sceneType 10`: **nivel del Fan Club** del streamer, 1 a 35
    (`combine.str` = nombre del club; icono `_grey` = club inactivo).
  - `sceneType 6`: **ranking de donantes de la sala** (`combine.text` "No. N").
- `user.payGrade.level` llegó en 0 en todos los mensajes: no sirve.
- **No existe un mensaje explícito de "subió de nivel"** (ninguno de los 25 tipos
  de mensaje de la grabación). La subida solo se detecta comparando el nivel
  anterior y el nuevo de un mismo usuario.
- `userIdentity` (en el mensaje, no en `user`) trae `isFollowerOfAnchor`,
  `isSubscriberOfAnchor`, `isModeratorOfAnchor`. En 203 mensajes con usuario
  completo, `user.isFollower` fue true en 0 casos y `isFollowerOfAnchor` en 146
  (y `user.isSubscribe` detectó 12 suscriptores contra 20 de
  `isSubscriberOfAnchor`). Esto corrige la fuente asumida en el ADR 0005 para
  `seguidor` y `suscriptor`; ya se aplicó en `extractUserFlags`.

## Opciones consideradas

1. **Solo campos de nivel en `LiveEvent`** (sin eventos de subida). Barato, pero
   no habilita "Simular Fan/Donor Lvl" ni disparar acciones al subir de nivel.
2. **Campos de nivel + eventos de subida detectados en el sidecar** (elegida).
   Aditivo y opcional; el sidecar compara el nivel anterior y el nuevo.
3. **Detectar la subida en el motor** en vez de la fuente. Mezcla la lectura de
   TikTok con las reglas del motor y obliga a que el simulador conozca el estado
   interno. Descartada.

## Decisión

Cambios **aditivos y opcionales** en `live-event.ts` (nada existente cambia):

- `userLevel?: number`, `fanLevel?: number`, `topGifterRank?: number`: se
  rellenan solo cuando TikTok los reporta (ausencia = desconocido; un `nivel`
  requerido no coincide si no se conoce).
- Dos `LiveEventType` nuevos, `"fanLevelUp"` y `"donorLevelUp"`, con
  `previousLevel?: number` y `newLevel?: number`.

En el sidecar, un `LevelTracker` por sesión recuerda el último nivel visto por
usuario y emite el evento de subida cuando el nivel **aumenta** entre dos
mensajes vistos. **La primera vez que se ve a un usuario no cuenta como subida**
(no hay nivel anterior con el que comparar; evita disparar acciones cada vez que
entra alguien de nivel alto). Una bajada solo actualiza el nivel recordado. El
tracker se reinicia en cada conexión.

En `event.ts` (archivo propio de la app, no es contrato del mod):

- `porque` nuevos `subeNivelFan` y `subeNivelDonador`, con `nivelMinimo?: number`
  (solo dispara si el nivel nuevo es >= ese valor; por defecto 1).
- `nivelEquipoRequerido` pasa a evaluarse contra `fanLevel` (solo si es > 0; con
  0 se comporta como hasta ahora).
- `quien: donanteTop` usa `topGifterRank` cuando TikTok lo reporta; si no, sigue
  el ranking por monedas acumuladas de la sesión (ADR 0005).

"Simular Fan Lvl" y "Simular Donor Lvl" envían `fanLevelUp` / `donorLevelUp` por
el mismo canal `live-event` que los eventos reales.

## Consecuencias

- Los eventos "al subir de nivel" y el filtro por nivel de fan funcionan con
  datos reales y en el simulador.
- `mod-protocol.ts` no cambia: el mod de GTA V no se entera de este cambio.
- Limitaciones aceptadas: la primera aparición de un usuario nunca dispara; si
  la app se conecta con el live ya empezado, las subidas previas no se ven; el
  mapeo `sceneType 8` = nivel de donador es una inferencia (cambia con regalos y
  se llama "nivel de usuario" en TikTok) y `sceneType 10` = Fan Club se apoya en
  el nombre del club y el icono. Si TikTok cambia los `sceneType`, el nivel
  queda ausente (nunca se inventa).
- El compactador de grabaciones conserva `badgeList`, así que las grabaciones
  nuevas siguen sirviendo para verificar estos supuestos.
