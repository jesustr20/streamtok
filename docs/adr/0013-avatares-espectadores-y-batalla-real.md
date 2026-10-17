# 0013. Foto de perfil, espectadores y batalla real de TikTok

- Estado: proposed (Jesús lo pidió y aprobó el cambio de contrato el 2026-10-16; falta validar la batalla con un LIVE real)
- Fecha: 2026-10-16
- Issue: —

## Contexto

Los overlays que Jesús quiere copiar de Interactive, TikFinity y TikControl muestran
la foto de perfil de quien interactúa (tops, chat, alertas, cañón de regalos), el
número de espectadores (meta y contador) y el marcador real de una batalla de
TikTok (Battle PK, MVP de la batalla). Hoy nada de eso llega a los overlays.
Jesús aprobó explícitamente cambiar el contrato para tenerlo.

`tiktok-live-connector` (2.5.0) ya los expone: el usuario de cada mensaje trae sus
imágenes de avatar, `roomUser` trae el número de espectadores y `linkMicArmies`
trae los puntos de cada lado de una batalla.

## Decisión

1. **Foto de perfil**: se añade `avatarUrl` (opcional) a `LiveEvent`. Es el único
   cambio en `live-event.ts`: un campo nuevo y opcional, así que nada existente se
   rompe. La URL es la de la CDN de TikTok; el overlay la carga directamente (necesita
   internet; sin ella el overlay muestra una inicial).
2. **Espectadores y batalla NO son `LiveEvent`**: no son algo que haga un usuario, son
   el estado de la sala. Van en un archivo nuevo (`room.ts`) y un canal WS nuevo `room`
   (`get-state` / `state`), con el mismo patrón que `overlays` y `goals`. Así
   `live-event.ts` y `mod-protocol.ts` no cambian más.
3. **Batalla**: se guarda el último marcador visto (`sides` con puntos y mejores
   apoyadores) sin interpretar el estado de la batalla, porque no está verificado cómo
   avisa TikTok el inicio y el final. Los overlays de batalla real se construirán
   encima cuando se valide con una grabación.
4. **Metas de espectadores**: una meta con métrica `viewers` copia el número de
   espectadores (no acumula). Viene como meta de fábrica.

## Riesgos

- El formato exacto de `linkMicArmies` está tomado de los tipos de la librería, no de
  una batalla real. El parser es tolerante (varias formas conocidas) y devuelve "sin
  batalla" si no entiende el mensaje. **Pendiente**: grabar un LIVE con batalla
  (la grabadora ya guarda estos mensajes crudos) y ajustar contra datos reales.
- Las URL de avatar están firmadas y caducan; se renuevan con cada mensaje.
