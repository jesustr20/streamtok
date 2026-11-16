# ADR 0024 — Memoria del agente IA (streamer, viewers, contexto y trivia)

- Estado: propuesto
- Fecha: 2026-11-12
- Relacionado: ADR 0016 (agente IA), ADR 0020 (cambios sin guardar)

## Contexto

Hoy el agente recibe en cada pregunta solo su nombre, su personalidad y el «Contexto del canal» que escribe el streamer (`liveContext`). No recuerda a los viewers, no sabe quién es el dueño del LIVE, no entiende de qué se habla en el chat y no tiene dónde guardar la trivia que ya usó. Eso limita la calidad de las respuestas y la naturalidad al conversar.

Se quiere que el agente:
- guarde en un JSON, aparte de su configuración, lo que sabe del streamer, de los viewers y de la trivia;
- entienda el contexto del chat y conozca a los viewers por su nombre;
- responda con precisión cuando preguntan por el streamer, **sin reglas fijas por nombre**: si el dueño se llama «Jesús», debe priorizar al dueño del LIVE y no al personaje religioso; si no sabe algo del streamer, debe preguntarle;
- converse con naturalidad, también leyendo el chat y no solo cuando alguien escribe `!ia`.

Es cara de revertir porque define el formato de los datos de los viewers (información de personas reales), cuándo y cuánto se llama al modelo (costo) y qué se guarda.

## Decisión

### 1. Dos archivos nuevos, por perfil, aparte de `agente.json`
- `agente-memoria.json`: streamer, viewers, pendientes y conductas aprendidas. Cambia poco y se lee entero.
- `agente-trivia.json`: historial de las últimas 200 preguntas lanzadas (solo el texto). Se descartó un banco de preguntas con respuesta: el modelo ya las inventa y lo que faltaba era recordar las usadas. Va aparte porque cambia en cada LIVE.
- El **contexto reciente del chat** (últimos N mensajes con nombre) vive solo en memoria RAM y no se guarda.
- Ambos archivos llevan `version`, se escriben de forma atómica (archivo temporal y renombrado), se validan con Zod en `shared` y quedan fuera de los datos que se reparten con la app (cada usuario nuevo empieza en blanco).

### 2. El streamer es un dato, no una regla
- Ficha del streamer: nombre, alias, y hechos que el streamer escribe o responde. El nombre y el @ del dueño salen de la cuenta conectada al LIVE.
- Al prompt entra una línea de datos («Dueño del LIVE: …, también conocido como …») y una instrucción general: cuando se pregunte por «el streamer», «el dueño» o por su nombre, se habla de esta persona. No hay condiciones por nombre ni listas de excepciones.

### 3. Cuando no sabe algo del streamer: modo configurable
`preguntarAlStreamer`: `preguntar` | `solo-memoria` | `mixto` (valor por defecto: `mixto`).
- **preguntar:** el agente dice que va a preguntarle; en el panel del agente aparece una tarjeta con la pregunta, un campo de texto y los botones «Responder», «No quiero contestar» e «Ignorar», con aviso sonoro. La respuesta se reformula con la personalidad del agente, se dice a quien preguntó y se guarda como hecho del streamer.
- **solo-memoria:** si no está en la memoria, dice que no lo sabe.
- **mixto:** pregunta solo si la duda parece importante; si no, responde con lo que sabe.
- Si el streamer no contesta en un tiempo configurable (30 s por defecto), el agente dice que lo dejó anotado y la duda queda en una lista de pendientes que se contesta después.
- Tope de preguntas al streamer por LIVE. La respuesta es por **texto** en la versión 1; la respuesta por voz queda para cuando exista la conversación por micrófono.

### 4. Memoria de viewers
- **Sin modelo (siempre):** @usuario, nombre visible, primera y última vez, número de preguntas, última pregunta.
- **Con el modelo:** cada cierto tiempo, en lotes, se extraen datos que el viewer dijo **de sí mismo** (gustos, de dónde es, qué juega). Tope de llamadas por LIVE y apagable.
- Nunca se guardan datos sensibles (salud, política, religión, orientación sexual, contacto, ubicación exacta, menores de edad, datos económicos); el prompt de extracción lo prohíbe y se filtra la salida por una lista de categorías.
- Nada de lo que escribe un viewer se trata como instrucción: es dato (misma defensa que ADR 0016).
- Pantalla para ver, editar y borrar lo guardado de cada viewer; olvido automático de viewers inactivos tras un tiempo configurable; comando `!olvidame` para que el viewer pida borrar lo suyo.

### 5. Conversación natural
- El agente lee el chat, pero **un filtro local barato decide si vale la pena llamar al modelo** (lo nombran, es una pregunta dirigida a él, responde a algo que él dijo, pregunta sin respuesta reciente). El chat completo nunca se manda al modelo.
- Nivel de iniciativa `baja | media | alta` (por defecto `media`) que ajusta qué tanto interviene por su cuenta.
- Las intervenciones propias tienen menos prioridad que la cola de preguntas, con tope por minuto, por LIVE y espera por viewer.

### 6. Qué entra al prompt
No se vuelca toda la memoria: se eligen los datos del streamer y del viewer relevantes para la pregunta (coincidencia de palabras) dentro de un presupuesto de caracteres, más el contexto reciente del chat resumido.

### 7. Conductas aprendidas (intentos de «hackear» al agente)
Contexto: algunos viewers intentan sexualizar o manipular al agente de forma sutil (conteos lentos, letras alargadas, frases que terminan en algo sexual). Una lista fija de palabras se esquiva fácil; se quiere que el agente aprenda.
- **Regla base, no lista de palabras:** las instrucciones del agente dicen que no participa en contenido sexual ni en conteos o repeticiones hechos para provocarlo. Cubre el primer intento, que ninguna memoria puede cubrir.
- **La señal de aprendizaje es el botón «Parar IA»** del programa (no una tecla global, para que no choque con los juegos). Al pulsarlo, además de callarla, la app toma los últimos mensajes del chat y la pregunta en curso, pide al modelo una descripción de una línea del patrón y la guarda en `conductas` dentro de `agente-memoria.json`.
- **Chequeo previo:** antes de entrar a la cola, una pregunta nueva pasa por un filtro local barato y, si hace falta, por un chequeo breve del modelo que la compara con las conductas guardadas y con las faltas previas del viewer. Si coincide, el agente responde con su personalidad, sin entrar al juego, y el viewer suma una falta.
- **Faltas:** al tercer intento el viewer queda ignorado el resto del LIVE, con aviso en el panel y posibilidad de revertirlo. Hay un botón «Ignorar a este viewer».
- **Revisión:** lista en el panel con lo aprendido, para borrar o corregir (evita que aprenda mal y deje de contestar a gente normal).
- Costo: una llamada extra por pregunta que pasa el filtro local; tope por LIVE y apagable.

### 8. Parar al agente por voz y panel de micrófono
- Parar tiene dos vías: el botón del programa y, por voz, «<nombre>, para» / «basta». La orden de parar se interpreta localmente, sin pasar por el modelo, y también cuenta como señal de aprendizaje.
- **Panel de micrófono** (antes de la voz): lista de micrófonos del equipo para elegir uno (p. ej. el micrófono aparte y no el de la cámara), barra de nivel en vivo y botón «Probar» que graba unos segundos y los reproduce. Se pausa la escucha mientras el agente habla (con parlantes se oiría a sí mismo).
- Hablarle al agente: palabra de llamada (su nombre) y, como alternativa, botón de hablar en la app. Antes de prometerlo se prueba si el reconocimiento de voz funciona dentro de la ventana de Tauri en Windows; si no, se transcribe con un servicio (Gemini o Whisper), con costo por uso.

## Fases
1. Memoria base: archivos, ficha del streamer, viewers sin modelo, selección de datos para el prompt.
2. Preguntas al streamer (los tres modos, tarjeta, pendientes, tope).
3. Aprendizaje de viewers con el modelo y pantalla de revisión y borrado.
4. Contexto del chat y conversación natural con el filtro local.
5. Conductas aprendidas: botón «Parar IA» como señal, regla base, chequeo previo, faltas por viewer y panel de revisión.
6. Panel de micrófono (elegir, nivel, probar).
7. Voz: hablarle al agente y «<nombre>, para».
8. Trivia sin repetir: historial persistente en `agente-trivia.json`, preguntas pedidas en lotes de 6 (temas y subtemas distintos) y filtro local de preguntas parecidas. (Reemplaza al «banco de trivia» previsto: no hace falta guardar preguntas, solo las ya usadas.)

## Consecuencias
- El agente responde con más precisión y conoce a la gente del chat.
- Se guardan datos de personas reales: de ahí las categorías prohibidas, el borrado y el olvido automático. Debe quedar dicho en el README.
- Más llamadas al modelo (extracción en lotes, conversación): costo controlado con topes y apagables.
- JSON basta para este volumen; si crece, se migra a SQLite sin cambiar los contratos.
- No cambia `mod-protocol.ts` ni `live-event.ts`.

## Pendiente de decidir al implementar
- Nombre del campo y estructura exacta del esquema Zod de cada archivo.
- Tiempo de olvido por defecto de viewers inactivos.
- Presupuesto de caracteres de la memoria dentro del prompt.
