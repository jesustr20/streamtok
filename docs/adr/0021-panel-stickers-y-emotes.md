# ADR 0021 — Panel «Stickers y emotes»

Estado: aceptado (2026-11-07). Solo UI de escritorio; no toca contratos ni el sidecar.

## Contexto

Las alertas por sticker/emote (Club de fans, Super Fan) se creaban en «Acciones y Eventos» dentro de Juegos, mezcladas con todo lo demás. Interactive las junta en una pantalla propia («Alertas») con una tabla: acción, evento (con la imagen del sticker), duración y descripción.

## Decisión

Nuevo ítem del menú **«Stickers y emotes»** con una tabla como la de Interactive:

| ▶ ✎ 🗑 | Activo | Acciones | Evento (imagen + origen) | Duración (seg) | Descripción (p. ej. «Audio: gato riendo») |

- **No hay datos nuevos.** Son los mismos Eventos y Acciones del perfil activo (canales `acciones` / `eventos`), filtrando los Eventos cuyo desencadenante es «sticker o emote» (incluidos los dos tipos antiguos). Se editan con los mismos modales (`AccionModal`, `EventoModal`).
- «+ Crear nuevo Evento» abre `EventoModal` con el desencadenante fijo en «sticker o emote» (`soloStickers`).
- ▶ ejecuta las acciones de la alerta como lo haría el Evento (audio incluido); el nombre de la acción abre su edición; 🗑 borra el Evento y conserva la Acción.
- La tabla de Eventos de Juegos ya no muestra los de stickers y avisa cuántos hay en este panel, para que Juegos no quede cargado.

## Consecuencias

- Las Acciones siguen compartidas: una acción creada aquí también se ve en la tabla de Acciones de Juegos.
- Es el perfil activo el que manda (como en Juegos); no hay alertas de stickers «globales» aparte del perfil.
