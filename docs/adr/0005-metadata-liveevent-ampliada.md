# 0005. Metadata de viewer en `LiveEvent` (quien/porque faltantes del motor)

- Estado: accepted
- Fecha: 2026-10-01
- Issue: #23

## Contexto

El motor genérico de Acciones y Eventos (ADR 0004) valida todo el dominio de
`quien` y `porque` en `EventoSchema`, pero en el runtime solo era capaz de
evaluar `quien: todos` y `quien: usuarioEspecifico`, y de los `porque` solo los
que mapeaban 1:1 a un `LiveEventType`. Quedaban 8 casos que **nunca coincidían**
y en silencio no hacían nada:

- `quien`: `seguidor`, `suscriptor`, `moderador`, `donanteTop`
- `porque`: `primeraActividad`, `emoteSuscriptor`, `stickerFanClub`,
  `compraTiktokShop`

La razón era que `LiveEvent` (packages/shared/src/live-event.ts) no llevaba la
metadata de viewer necesaria para evaluar esas condiciones. Este ADR decide qué
se puede implementar con lo que `tiktok-live-connector@2.5.0` expone de verdad
y qué se deja deliberadamente sin implementar (no se falsifica, no se aproxima
con otra señal).

## Investigación de la fuente (qué expone `tiktok-live-connector@2.5.0`)

`tiktok-live-connector` re-exporta los bindings del protobuf webcast de TikTok
(`tiktok-live-proto/v3`). Inspeccionando los `.d.ts` instalados y el dispatcher
de `processDecodedData` del conector:

- `WebcastChatMessage`, `WebcastGiftMessage`, `WebcastLikeMessage`,
  `WebcastMemberMessage`, `WebcastSocialMessage`, `WebcastSubNotifyMessage` y
  `WebcastEmoteChatMessage` llevan un campo `user: User`.
- `User` expone: `isFollower: boolean`, `isFollowing: boolean`,
  `isSubscribe: boolean`, `subscribeInfo: SubscribeInfo` (con su propio
  `isSubscribe`), `fansClub`/`fansClubInfo`, y `userAttr: UserAttr` con
  `{ isAdmin, isSuperAdmin, isChannelAdmin }`.
- El conector emite un evento `emote` (`WebcastEmoteChatMessage`) con
  `emoteList: EmoteModel[]`. `EmoteModel` lleva `emoteId`, `emoteScene`
  (`EmoteScene.SUBSCRIPTION = 0`, `GAME = 1`, `FANS_CLUB = 2`) y
  `emotePrivateType` (`SUB_WAVE = 1`). Es decir, **el mismo mensaje** cubre el
  emote de suscriptor y el sticker del Fan Club, distinguidos por `emoteScene`.
- `WebcastGiftMessage` tiene `isFirstSent: boolean`, pero es específico de
  regalos (primer regalo), **no** un "primera interacción en el live".
- No hay un ranking de donantes listo por usuario. Existen
  `WebcastRankUpdateMessage`/`WebcastRankTextMessage`/`WebcastHourlyRankRewardMessage`,
  pero ninguno expone "posición del viewer en el top N de gifters de la sesión"
  de forma directa en el payload del regalo.
- `WebcastOecLiveShoppingMessage` (evento `oecLiveShopping`) es la señal de
  "live shopping" que emite el conector, pero su payload (`actionType`,
  `popProduct`, `productSnapShot`, `oecLiveShoppingMessageV2.actions`) describe
  acciones de UI de la tienda dentro del live (producto pineado, snapshot,
  botón "añadir al carrito"), **no** una compra confirmada, y además **no lleva
  campo `user`** (no identifica al comprador).

## Decisión

Se extiende `LiveEvent` (no `mod-protocol.ts`) con campos **opcionales**, que
solo se rellenan cuando la fuente los afirma en positivo (ausencia = desconocido
= ese `quien` no coincide):

- `isFollower?: boolean` — de `user.isFollower`.
- `isSubscriber?: boolean` — de `user.isSubscribe`.
- `isModerador` → `isModerator?: boolean` — de `user.userAttr.isAdmin ||
  user.userAttr.isSuperAdmin`.
- Nuevo `LiveEventType` `"emote"` con `emoteId?: string` y
  `emoteScene?: "subscriber" | "fanClub"` — de `WebcastEmoteChatMessage`,
  usando `EmoteScene.FANS_CLUB` para distinguir sticker de emote de suscriptor.

El ranking de `donanteTop` se computa en el motor: el sidecar acumula monedas
por handle durante la sesión (`gifterCoins`) y calcula un ranking "dense" (los
empates comparten posición: rank = 1 + cantidad de totales estrictamente
mayores). Se reinicia con `AccionesEventosEngine.resetSession()`, invocado al
conectarse una nueva sesión de TikTok LIVE.

### Matriz de los 8 casos originales

| Caso | Estado | Nota |
|---|---|---|
| `quien: seguidor` | ✅ Implementado | `User.isFollower` en `user` del evento |
| `quien: suscriptor` | ✅ Implementado | `User.isSubscribe` en `user` del evento |
| `quien: moderador` | ✅ Implementado | `User.userAttr.isAdmin \|\| isSuperAdmin` |
| `quien: donanteTop` | ✅ Implementado | Ranking propio por monedas acumuladas en la sesión (no hay rank listo en la lib) |
| `porque: emoteSuscriptor` | ✅ Implementado | evento `emote` + `emoteScene === "subscriber"` + `emoteId` |
| `porque: stickerFanClub` | ✅ Implementado | evento `emote` + `emoteScene === "fanClub"` + `emoteId` (vs `stickerId`) |
| `porque: primeraActividad` | ❌ No implementado | No hay señal general de "primera interacción en el stream"; `isFirstSent` de `WebcastGiftMessage` es solo para regalos |
| `porque: compraTiktokShop` | ❌ No implementado | `WebcastOecLiveShoppingMessage` no es una compra confirmada y no identifica al comprador (`user` ausente) |

## Consecuencias

- `quien: seguidor/suscriptor/moderador/donanteTop` y `porque:
  emoteSuscriptor/stickerFanClub` ahora disparan con datos reales.
- `primeraActividad` y `compraTiktokShop` siguen sin coincidir, igual que antes,
  pero ahora con una razón documentada (no se falsifican con otra señal).
- Las banderas de viewer dependen de que TikTok las pueble en el `user` embebido
  de cada mensaje. En la práctica el protobuf a veces envía un `user` reducido;
  si `isFollower`/`isSubscribe`/`userAttr` vienen vacíos, el `quien`
  correspondiente simplemente no coincide (comportamiento conservador: nunca se
  asume un rol que no se confirmó).
- `emoteScene` mapea `EmoteScene.FANS_CLUB` → `fanClub` y todo lo demás
  (`SUBSCRIPTION`, `GAME`, `UNRECOGNIZED`) → `subscriber`. Un emote de tipo
  "GAME" (poco común) quedaría etiquetado como `subscriber`; el riesgo es menor
  porque los ids de esos emotes no coincidirán con un `emoteId` de suscriptor
  configurado. Documentado como limitación aceptada.
