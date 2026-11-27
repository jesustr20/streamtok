# ADR 0026 — La IA como mano derecha del streamer

Estado: aceptada · Fecha: 2026-11-26 · Amplía el ADR 0016 y el ADR 0024

## Contexto

En un LIVE real el agente no respondía al streamer como a un colaborador: no veía el chat (no podía traducir ni explicar
lo que dijo un espectador), trataba la voz del dueño como una pregunta pública más (con requisitos de seguimiento/regalo),
no seguía una conversación sin repetir su nombre y la parada por voz borraba toda la cola.

## Decisión

1. **El dueño del LIVE manda.** Sin requisitos de elegibilidad, sin esperar el turno de las respuestas gratis y con
   prioridad sobre la cola. Su texto va en `<streamer>` (instrucciones de confianza); siguen mandando las reglas 4 y 7
   (rechazo de contenido ofensivo/datos personales/claves/dinero y no participar en juegos sexuales) y no pasa por el
   detector de inyección. El filtro de salida contra fuga del prompt (`PROMPT_LEAK`) sigue activo también con él.
2. **Si está ocupada no lo corta.** Responde como una persona ocupada («un momento, Jesús…», aunque los avisos personales
   estén apagados), termina la respuesta en curso y lo atiende justo después. Máximo 3 peticiones suyas en cola.
3. **Entrada.** Por voz (nombre de la IA, con ventana de seguimiento de 20 s sin repetir el nombre) o por chat (nombre,
   `!ia` o seguimiento). Un comentario suyo sin mencionarla es solo charla.
4. **Parada suave por voz.** «Para» calla la respuesta actual, descarta a quien la provocó, hace un respiro de 3 s y el
   resto de la cola sigue. El botón de parar mantiene el comportamiento anterior (vacía la cola).
5. **Charla del día en RAM.** Últimos 40 comentarios (sin disco, se borra al empezar otro LIVE); al prompt entran ≤1800
   caracteres como `<chat_reciente>` más las últimas respuestas como `<tus_respuestas>`, siempre en el mensaje de usuario
   y como DATOS (nunca instrucciones). Los ignorados no entran y se neutralizan `<` y `>`.
6. **Traducir y responder en otro idioma** (regla 10): traduce al español diciendo quién lo escribió, responde en el
   idioma pedido empezando por el nombre/usuario sin `@`, explica por qué dijo algo y admite si no encuentra el mensaje.
7. **Todo público.** Las preguntas del dueño y las respuestas salen en el overlay, para que el público vea la
   conversación. No hay canal privado.

## Límites conocidos

- La trivia en curso sigue pausando al agente (también al dueño).
- «Un momento» espera a que termine la respuesta actual (hasta ~45 s en pantalla).
- La voz en otros idiomas depende del motor de voz (la del sistema es floja; Gemini TTS mejor).

## Fases siguientes (no incluidas)

- C: panel opcional de traducción automática del chat.
- D: batallas — escuchar y traducir el audio del rival, responder «¿qué dijo?» y hablarle en su idioma. Pendiente saber
  por dónde suena el audio del rival (LIVE Studio en PC o teléfono).

## Consecuencias

Costo: ~500 tokens de contexto por respuesta. Superficie de inyección: el chat ya era no confiable; ahora además entra
como contexto, pero solo dentro de etiquetas de datos y nunca en el system prompt.
