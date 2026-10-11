# 0009. Regalos con combo: ejecutar una vez por regalo (`repeatCount`)

- Estado: accepted (aprobado por Jesús el 2026-10-10)
- Fecha: 2026-10-10
- Issue: —

## Contexto

TikTok manda cada regalo con combo (`gift.type === 1`, p. ej. Rose) en varios
mensajes: uno o más "en curso" (`repeatEnd 0`) con la cantidad ACUMULADA del
streak (`repeatCount`: 1, 3, 4, 5…, no siempre consecutivos) y un mensaje de
cierre (`repeatEnd 1`) con el total. Una sola rosa llega como `rc 1 / en curso`
+ `rc 1 / cierre`.

El motor ejecutaba las acciones con `repetirConComboDeRegalos: true` en TODOS
esos mensajes, incluido el cierre. Resultado: una rosa ejecutaba la acción dos
veces (se cambiaba dos veces el carro) y, en rachas, el total era casual.

`LiveEvent` (`packages/shared/src/live-event.ts`) es parte del contrato y no
llevaba la cantidad del streak; cambiarlo exige ADR y aprobación explícita
(AGENTS.md, regla 1).

## Opciones consideradas

1. **Sin tocar el contrato:** no repetir en el cierre lo que ya disparó en curso.
   Evita el doble de una rosa, pero una racha de 5 rosas ejecuta solo 4 veces
   (TikTok se salta cantidades) y se pierde el conteo.
2. **Campo opcional `repeatCount` en `LiveEvent` + ejecutar la diferencia.**
   Aditivo y compatible: sin `repeatCount` se cuenta 1.

## Decisión

Opción 2.

- `live-event.ts`: `repeatCount` (entero positivo, opcional) en eventos `gift`.
- Sidecar (`tiktok-source.ts`): se lee de `repeatCount` del mensaje de regalo.
- Motor: una acción con `repetirConComboDeRegalos: true` se ejecuta tantas veces
  como regalos NUEVOS haya desde el último mensaje del mismo streak
  (clave evento + acción + usuario + regalo). Una rosa suelta = 1; una racha de
  5 = 5 (1+2+1+1) y el cierre no repite. Si no llegaron los mensajes en curso,
  el cierre ejecuta el total. El estado se limpia al cerrar el streak, al
  cambiar los eventos y al reconectar.
- Las acciones SIN "repetir con combo" siguen ejecutándose una sola vez, al cierre.
- Un regalo sin `repeatEnd` (Simulador) no tiene streak: ejecuta `repeatCount ?? 1`.

## Consecuencias

- "Repetir con combo" cuenta cada regalo sin perder ninguno y sin duplicar.
- Si el cierre de un streak se pierde y empieza otro, la cantidad baja y el
  motor lo detecta como streak nuevo. Un nuevo streak que empiece con la MISMA
  cantidad que el anterior sin cierre puede descontar un regalo (caso raro:
  TikTok siempre manda el cierre).
