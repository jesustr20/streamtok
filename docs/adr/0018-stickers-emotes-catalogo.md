# ADR 0018 — Sticker o emote como un solo desencadenante, con catálogo aprendido

- Estado: propuesto
- Fecha: 2026-11-05
- Relacionado: ADR 0005 (metadata de LiveEvent; `emoteSuscriptor` / `stickerFanClub`), issue #35 (catálogo de regalos aprendido)

## Contexto

El modal de Evento tenía dos desencadenantes casi iguales: "emote de suscriptor" y "sticker del club de fans", cada uno con un campo de texto donde había que escribir el id a mano ("Catálogo real pendiente"). Para TikTok son el mismo mensaje (`WebcastEmoteChatMessage`); solo cambia `emoteScene`. Además TikTok renombró la suscripción de LIVE a **Super Fan** (septiembre de 2025, según una nota de prensa; la librería sigue llamando `SUBSCRIPTION` a esa escena).

La librería `tiktok-live-connector` no ofrece una función para listar los stickers o emotes de un canal. Lo que sí llega es el mensaje de cada envío, con el id y la imagen (`emote.image.urlList`).

## Decisión

1. **Un solo desencadenante** en la UI: "Enviando un sticker o emote" (`porque: "stickerEmote"`), con `emoteId` opcional y `emoteScene` opcional (`subscriber` | `fanClub`). Sin id = cualquiera (del origen elegido, o de todos). La UI llama Super Fan al origen `subscriber` y Club de fans a `fanClub`.
2. **Compatibilidad**: `emoteSuscriptor` y `stickerFanClub` siguen siendo válidos y siguen disparando (Eventos ya guardados, sin migrar el archivo). Ya no se ofrecen en la lista; al editar uno, el modal lo abre como "sticker o emote" con su id y origen, y al guardar queda con el tipo nuevo.
3. **Catálogo aprendido** (`emote-catalog.json`, canal WS `emote-catalog` con `get-state`/`state`), mismo patrón que el de regalos pero sin semilla: cada mensaje `emote` registra id, origen, imagen y cuántas veces llegó. La imagen se refresca cada vez que llega con otra URL. El contador se guarda unos segundos después, para no escribir en disco por cada sticker.
4. **Selector en lista** (`EmotePicker`), igual que el de regalos: atajos "Cualquier sticker o emote" / "Cualquiera de Club de fans" / "Cualquiera de Super Fan" y debajo los aprendidos, agrupados por origen y ordenados por uso. La columna "Trigger" de la tabla de Eventos y "Simular Eventos" usan el mismo catálogo.
5. No se toca `live-event.ts` ni `mod-protocol.ts`.

## Riesgos y supuestos por validar

- **Solo se aprenden los que ya se enviaron.** No hay forma conocida de pedir la lista completa. Un sticker que nadie ha mandado no aparece hasta que llegue (mientras tanto sirve "Cualquiera").
- **El origen de Super Fan no está confirmado.** Se asume que sigue llegando como `EmoteScene.SUBSCRIPTION` (0); cualquier otro valor cae en `subscriber` por defecto. Cada sticker nuevo deja en el log del sidecar el código real que mandó TikTok (`[emote-catalog:info] … código de TikTok N`) para confirmarlo con un LIVE real.
- **Las URLs de imagen pueden caducar.** Se refrescan cuando el mismo id vuelve a llegar y la miniatura cae a un recuadro neutro si no carga. No se descargan las imágenes.
- Cargar el catálogo completo con la sesión de TikTok del streamer (como hace Interactive) queda como alternativa futura; exigiría un ADR propio por guardar credenciales.

## Alternativas descartadas

- Mantener los dos desencadenantes: confunde (son el mismo mensaje) y el nombre "suscriptor" ya no es el de TikTok.
- Migrar los Eventos guardados al abrir el archivo: riesgo innecesario; basta con aceptar ambos tipos.

## Corrección (2026-11-06): emotes dentro del chat

El catálogo solo escuchaba el mensaje `emote` (sticker/emote enviado suelto). Los emotes de Super Fan que se escriben **dentro de un comentario** llegan en `WebcastChatMessage.emotes[].emote` (el mismo `EmoteModel`: id, imagen, escena), así que no se aprendían. Ahora el mensaje de chat también alimenta el catálogo (`extractChatEmoteCatalogEntries`). El comentario sigue siendo un evento de chat normal; el desencadenante "sticker o emote" de los Eventos sigue disparándose solo con el mensaje `emote` (disparar con emotes del chat queda por decidir).

## Cambio (2026-11-06): sin contador

Como el catálogo de regalos: se compara por id; si no existe se agrega solo, y si ya existe **no se hace nada** (no se cuenta ni se avisa a la UI). Solo se refresca la imagen o el origen si TikTok mandó otros. Se quitó el "×N" de la lista y el orden por veces vistas (ahora por orden de llegada). El campo `count` se conserva en el esquema solo para leer archivos guardados antes.
