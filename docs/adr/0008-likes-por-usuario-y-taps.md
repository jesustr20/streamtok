# 0008. Likes: contar taps reales y acumular por usuario

- Estado: accepted (aprobado por Jesús el 2026-10-07)
- Fecha: 2026-10-07
- Issue: —

## Contexto

El evento "Dando likes" (`porque: "likes"`, `cantidadMinimaLikes`) debía
disparar "cada N likes", pero el motor tenía dos fallos:

1. **El contador era uno solo por Evento**, no por persona: los likes de todos los
   viewers se sumaban juntos y el log ("like acumulado (5/20)") no decía de
   quién eran.
2. **Contaba mensajes, no taps.** TikTok agrupa varios taps en un mensaje
   `WebcastLikeMessage` (campo `count`, máximo observado 15). En una grabación
   real, 609 mensajes sumaron 7.448 taps (unos 12 por mensaje; 420 traían 15).
   Con N = 20 el evento disparaba tras ~240 taps.

`LiveEvent` (`packages/shared/src/live-event.ts`) es parte del contrato y no
llevaba la cantidad de taps; cambiarlo exige ADR y aprobación explícita
(AGENTS.md, regla 1).

## Opciones consideradas

1. **Solo por usuario, contando mensajes** (sin tocar el contrato). Arregla el
   fallo 1 pero deja el 2: un "20" sigue siendo ~240 taps.
2. **Campo opcional `likeCount` en `LiveEvent` + contador por usuario.** Aditivo
   y compatible: sin `likeCount` el motor cuenta 1.

## Decisión

Opción 2.

- `live-event.ts`: `likeCount` (entero positivo, opcional) en eventos `like`.
- Sidecar (`tiktok-source.ts`): `likeCount` se lee de `count` del mensaje de like
  (o `likeCount`, según la versión del conector).
- Motor: acumula taps por (Evento, usuario) módulo N. Dispara una vez por cada N
  completo cruzado; el resto queda como acumulado de ese usuario. El log muestra
  `nombre: taps/N likes`.
- "Simular Likes" manda un solo evento `like` con `likeCount` = N, como TikTok.
- El acumulado se reinicia al conectar un LIVE (`resetSession`) y al guardar
  Eventos (`setEventos`).

## Consecuencias

- "20 likes" significa 20 taps de la misma persona, y la acción recibe el
  `nameTag` de quien lo cumplió.
- Un mensaje con más de N taps puede disparar el evento más de una vez (con
  N < 15). Es lo esperado: cada N completo es un disparo.
- Los acumulados viven solo en memoria: si el sidecar se reinicia, se pierden.
- No cubre un "total de likes de la sala" (existe `total` en el mensaje) ni la
  suma entre varios usuarios.
