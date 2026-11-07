# ADR 0023 — Stickers y Juegos no se mezclan

Estado: aceptado (2026-11-07).

## Contexto

El panel «Stickers y emotes» (ADR 0021) reutiliza los modales de Acciones y Eventos, pero guardaba todo en la misma lista que Juegos: las acciones creadas en un sitio se veían (y se podían vincular) en el otro.

## Decisión

- `Accion.ambito` opcional: `"stickers"` = creada en el panel de stickers; ausente = Juegos. Sin migración de formato.
- El panel solo lista y ofrece sus acciones; Juegos solo las suyas (tabla y selector de acciones del Evento).
- Los eventos ya estaban separados por el desencadenante («sticker o emote» solo en el panel); además se quitó esa opción del selector de Juegos.
- Migración única al abrir el panel: las acciones sin ámbito usadas solo por alertas de sticker pasan a `stickers`. Si una acción también la usa un evento de Juegos, se queda en Juegos.
- Los ejecuta el mismo motor: separar solo cambia dónde se ven y editan.
