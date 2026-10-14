# 0010. Cooldown global y por usuario en las Acciones

- Estado: accepted (reglas confirmadas por Jesús el 2026-10-13)
- Fecha: 2026-10-13
- Issue: —

## Contexto

El modal de Acciones debe tener "Cooldown global" y "Cooldown por usuario" como
TikFinity. Hoy una Acción se dispara cada vez que un Evento coincide, sin límite.
Hay que guardar dos datos nuevos en la Acción (`packages/shared`, que es el
contrato UI↔sidecar) y un motivo de descarte nuevo en el log de eventos, por eso
va con ADR y aprobación (AGENTS.md, reglas 1 y 5). No toca `mod-protocol.ts` ni
`live-event.ts`.

## Reglas (decididas)

- **Es un bloqueo, no un retraso.** Tras ejecutarse una Acción, queda bloqueada
  durante N segundos. (El "Retraso de la acción" del modal es otra cosa y no se toca.)
- **Global:** bloquea la Acción para todo el chat.
- **Por usuario:** bloquea la Acción solo para quien la disparó, identificado por
  su `@username` (no por el nombre visible). Otros usuarios no se ven afectados.
- **Ambos a la vez:** la Acción solo corre si no están bloqueados ni la Acción
  (global) ni el usuario. Si se ejecuta, arranca el contador de ambos.
- **0 o ausente = sin cooldown.** Con 1 s o más aplica. Las Acciones existentes no cambian.
- **Intento durante el bloqueo:** se descarta, sin cola ni reintento, y queda una
  entrada en el log (`reason: "cooldown"`). Un regalo bloqueado se pierde para esa Acción.
- **Cuándo empieza a contar:** cuando la Acción se ejecuta (el contador se reserva
  antes de enviar para que dos eventos casi simultáneos no pasen los dos; si el mod
  rechaza TODOS los comandos de la Acción, se devuelve el contador a como estaba).
- **Con "repetir con combo":** el cooldown cuenta por ejecución de la Acción, no por
  cada repetición de un mismo mensaje del combo. Los regalos del combo que lleguen
  durante el bloqueo se descartan (y quedan contados como ya procesados, para no
  ejecutarse en bloque cuando termine el cooldown).
- **Estado en memoria.** Se borra al iniciar/reconectar el LIVE (`resetSession`).
  Al editar una Acción se reinician solo los cooldowns de las Acciones cuyos
  segundos cambiaron (o que se borraron).
- **El Simulador** pasa por el mismo motor, así que también respeta el cooldown.

## Opciones consideradas

1. **Estado en memoria en el motor (elegida).** Simple, sin migración, coherente
   con `likeCounts` y `streakFired`.
2. **Persistir en disco.** Sobreviviría a reinicios, pero el streamer pidió que
   un reinicio del LIVE lo ponga todo en 0; costo sin beneficio.
3. **Cooldown a nivel de Evento.** TikFinity lo pone en la Acción y una Acción puede
   colgar de varios Eventos; por Evento permitiría saltarse el límite con otro Evento.

## Consecuencias

- `Accion` gana `cooldownGlobalSeg` y `cooldownUsuarioSeg` (opcionales, no negativos);
  perfiles guardados siguen válidos sin migrar.
- `EventLogReason` gana `"cooldown"`.
- Los cooldowns se pierden al reiniciar StreamTok o reconectar al LIVE (decidido).
