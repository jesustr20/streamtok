# ADR 0015 — Duelos (overlay `duelo`)

- Estado: propuesto
- Fecha: 2026-10-17
- Relacionado: ADR 0012 (overlays con varias instancias), ADR 0013 (fotos de perfil y estado de la sala), ADR 0014 (alertas; mismo patrón)

## Contexto

Interactive (Gift vs Gift, GVSG Multi / Bar / Battle, BLUE vs RED, Batalla Top 1 vs Top 2) y TikControl (Regalos vs Regalos) muestran dos lados que compiten en pantalla. StreamTok ya recibe todo lo necesario (regalos con combo, likes, comentarios y la foto de perfil, ADR 0013), pero no tenía dónde sumarlo ni dibujarlo.

La batalla real de TikTok (PK entre dos anfitriones) es otra cosa: llega por el canal `room` (ADR 0013) y sus parsers aún no están validados con un LIVE real. Queda fuera de este ADR.

## Decisión

1. **Nuevo tipo de overlay `duelo`**, con instancias (`/overlay/duelo/<id>`) como las Metas y las alertas. De fábrica: `regalo-vs-regalo`, `equipos` y `top`. Tres diseños: Barra de fuerza (GVSG Bar), Frente a frente (GVSG Battle, Top 1 vs Top 2) y Marcador (BLUE vs RED con contadores).
2. **Tres modos**, con una sola configuración (`DuelConfig`: dos lados con nombre, color, regalos y comandos):
   - `regalos`: cada lado suma los regalos de su lista (nombre sin importar mayúsculas, o id numérico). Un regalo por lado es "Gift vs Gift"; varios, "Regalos vs Regalos" y "GVSG Multi". Se cuenta por cantidad de regalos o por monedas.
   - `equipos`: la gente elige equipo con un comando del chat (primera palabra del comentario). Desde ahí, sus regalos, likes o comentarios (según lo que se cuente) suman a su equipo. El primer equipo elegido se queda. Quien no eligió no suma.
   - `top`: los dos mayores donadores de la sesión, por monedas, con su foto.
3. **Nuevo canal WS `duelos`** (`get-state`, `state`, `save`, `reset`, `adjust`, `error`) y archivo `duelos.json` (escritura atómica) con la configuración y el marcador. El marcador sobrevive a reiniciar la app; el ranking del modo `top` se reinicia al conectarse a otro LIVE (es "de la sesión"), los demás se reinician a mano.
4. **No se toca `live-event.ts` ni `mod-protocol.ts`.** El sidecar solo lee eventos que ya existen. Los combos de regalos se cuentan por la diferencia de cada mensaje (igual que las metas) para no duplicar.
5. El estado se envía como máximo cada 150 ms (los likes llegan por cientos).
6. En la vista previa de la app el overlay corre en modo demostración (marcador de ejemplo que sube solo).

## Límites y riesgos

- Los marcadores persistidos guardan solo los mejores aportadores (20 por lado, 100 donadores) y hasta 5000 miembros por equipo; basta para el marcador y el MVP, pero no es un registro histórico.
- Las URLs de foto de TikTok caducan; si la imagen falla se muestra la inicial.
- Falta probarlo en un LIVE real (nombres exactos de regalo en el catálogo del streamer, comandos del chat).
- No hay todavía comandos de Acciones (`app.duelo.*`) para mover el marcador; por ahora se corrige desde la pantalla.

## Alternativas descartadas

- Un tipo de overlay por cada diseño de Interactive: los modos comparten datos y solo cambia el dibujo, así que son diseños de un mismo overlay.
- Añadir un evento de "elige equipo" a `LiveEvent`: el comando del chat ya llega como `comment`.
- Usar el estado de batalla de TikTok (`room`) como fuente: sin validar con LIVE real; será el siguiente paso (Battle PK y MVP de la batalla).
