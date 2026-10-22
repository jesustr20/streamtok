# ADR 0016 — Agente IA (módulo `agente`)

- Estado: propuesto
- Fecha: 2026-10-19
- Relacionado: ADR 0013 (avatares y estado de la sala), ADR 0014 (comunidad "Quiéreme"), ADR 0015 (duelos; mismo patrón de canal + persistencia)

## Contexto

Streams como "Cloud90 AI" ponen un agente de IA que responde en pantalla (texto y voz) a las preguntas del chat: una cola donde los regalos dan prioridad, respuestas gratis cada cierto tiempo para quien sigue o comparte, trivias con opciones A/B/C que da puntos y un "Top Trivia", y relleno (datos curiosos, chistes, cómo funciona) cuando no hay preguntas.

StreamTok ya recibe todo lo que hace falta (comentarios, regalos con monedas, seguir, compartir, "se unió" por Heart Me) pero no tiene un modelo de IA, voz ni claves de API. Es una función grande que agrega una dependencia externa, costos y una superficie de ataque (texto de desconocidos enviado a un modelo), por eso va con ADR (AGENTS.md, regla 5).

## Decisión

### 1. Un módulo más, con piezas intercambiables
Nuevo overlay `agente` (una instancia) y nuevo canal WS `agente`, con la misma forma que `duelos` (estado, configuración, persistencia atómica en `agente.json`). En el sidecar vive en `packages/sidecar/src/agente/`, con piezas pequeñas que se prueban por separado y se conectan por interfaces:

- `ModelProvider`: `complete({ system, user, maxTokens, signal }) → texto`. Un adaptador "compatible con OpenAI" (cubre DeepSeek, OpenAI, Gemini por su endpoint compatible y otros) y uno para Claude. Agregar un proveedor es agregar un adaptador.
- `TtsProvider`: `speak(texto, voz) → audio (wav/mp3)`. Primero las voces de Windows; después servicios en la nube.
- `Queue`: cola con prioridad.
- `Eligibility`: quién puede preguntar.
- `Trivia`: motor de trivia.
- `Filler`: relleno y explicaciones periódicas.
- `Guard`: limpieza de entrada y salida, límites y tope de gasto.

`shared` define con Zod los contratos (configuración, estado de la cola, mensajes). No se toca `live-event.ts` ni `mod-protocol.ts`.

### 2. Claves y proveedores
- **Cada usuario pone su propia clave.** La app no incluye ninguna.
- El usuario elige el proveedor y pega la clave (no se adivina el proveedor por el prefijo: DeepSeek y OpenAI empiezan igual). Hay un botón "Probar conexión". El selector solo lista proveedores con clave.
- Cada tarea (preguntas, trivia, relleno) puede usar un modelo distinto.
- Las claves se guardan solo en el equipo del usuario y **solo las lee el sidecar**: nunca viajan al overlay ni al estado que se envía por WS, ni se muestran enteras en la interfaz. Dónde se guardan exactamente (almacén seguro del sistema vs archivo local cifrado) se decide al implementar la fase (a), antes de aceptar la primera clave.
- Modelo por defecto sugerido: DeepSeek, por precio.

### 3. Cola, prioridad y quién puede preguntar
- Comando de pregunta configurable (por defecto `!ia`, primera palabra del comentario, como en los duelos). Nombre del agente y género configurables (el género del texto va en las instrucciones del modelo; el de la voz es la voz elegida).
- **Quién puede preguntar** es configuración con el mismo estilo de selector que Acciones y eventos: seguir, compartir, "Quiéreme", regalo, o combinaciones. El agente solo obedece lo configurado.
- **Prioridad:** primero quien más monedas aporta; a igualdad, el que llegó antes. La respuesta en curso termina antes de pasar a la siguiente. Las gratis salen una cada N segundos (configurable), al azar.
- **Regalo y pregunta:** un regalo da un **crédito** de unos minutos (configurable) al usuario; su siguiente pregunta lo usa. Así no importa si manda el regalo antes o después.
- Cola con tope de tamaño y de espera; lo que caduca se descarta.

### 4. Trivia y relleno
- Las preguntas las genera el agente, a un intervalo aleatorio cuando hay poca actividad. Solo datos estables y conocidos (sin noticias, precios, cifras exactas ni temas polémicos); el modelo verifica la pregunta en una segunda pasada y, si duda, no la lanza (da un dato curioso en su lugar). Se guardan las usadas para no repetir.
- Acierta quien responde la letra correcta en el chat: gana un **pase** (una respuesta gratis con prioridad) y un punto en el "Top Trivia". Si nadie acierta, el agente lo dice y revela la respuesta.
- El Top Trivia reutiliza el ranking de Tops y MVP, que se construye antes.
- Relleno: dato curioso o chiste cuando no hay preguntas ni trivia, y una explicación de cómo funciona cada cierto tiempo.

### 5. Seguridad (prompt injection y abuso)
1. **El agente no tiene poder:** solo devuelve texto. Nunca dispara Acciones ni comandos, ni lee archivos o claves.
2. El texto del espectador entra al modelo como **dato** dentro de un bloque marcado; las instrucciones dicen que no se obedece nada que venga de ahí. Ni las instrucciones ni la clave se repiten en el contexto.
3. **Salida limpia:** sin enlaces ni menciones, sin texto que empiece con `!` (para no activar comandos del chat), con tope de caracteres (el de un comentario de TikTok, unos 150, a confirmar) y corte duro.
4. **Entrada limitada:** largo máximo, respuestas por usuario por minuto, filtro de insultos y spam.
5. **Tope de gasto por hora** (y de respuestas por minuto); al alcanzarlo, el agente avisa y deja de responder hasta que pase la hora.
6. Al modelo se le manda solo el texto de la pregunta, sin nombre ni usuario. Se avisa en pantalla que las respuestas son generadas por IA.

### 6. Texto y voz juntos
La respuesta sale en texto (con efecto de escritura) y en voz a la vez. **El audio lo genera el sidecar y el overlay solo lo reproduce con `<audio>`**, que funciona en cualquier navegador y deja la voz intercambiable. No se depende de `speechSynthesis` del navegador porque puede no existir en TikTok LIVE Studio.

Para saberlo, este mismo parche agrega `/overlay/prueba-audio`, una página que prueba Web Audio, un archivo `<audio>` y `speechSynthesis` y escribe el resultado en pantalla.

### 7. Fases
- (a) Texto: overlay, cola con prioridad, comando, quién puede preguntar, proveedores y claves, seguridad y tope de gasto.
- (b) Trivia y Top Trivia (después de Tops y MVP).
- (c) Voz, relleno y explicaciones periódicas.

## Límites y riesgos

- Un modelo puede equivocarse: las respuestas son "certeras y cortas", no garantizadas. En trivia se mitiga como arriba; si se vuelve un problema, se agrega un banco de preguntas revisado.
- El audio de un overlay web **sí se reproduce en TikTok LIVE Studio** sin que nadie pulse nada (probado el 2026-10-19 con `/overlay/prueba-audio`: Web Audio, archivo `<audio>` y la voz del sistema). Sigue sin confirmarse el límite exacto de caracteres de un comentario de TikTok.
- Los proveedores cobran por uso y tienen sus propias políticas de datos; el usuario es quien las acepta al poner su clave.
- El texto de desconocidos nunca es 100 % inofensivo: la defensa principal es que el agente no pueda hacer nada más que escribir texto.

## Alternativas descartadas

- Una clave de StreamTok compartida: el costo y el abuso recaerían en un solo lugar.
- Detectar el proveedor por el prefijo de la clave: ambiguo (DeepSeek y OpenAI).
- Voz solo con `speechSynthesis`: depende del navegador de cada app.
- Un banco de trivia escrito a mano: la idea es que el agente lo haga solo; se puede sumar un banco opcional después.
- Que el agente ejecute Acciones: ampliaría mucho el daño posible de un engaño.

## Avance de la implementación

- **Fase (a), pieza 1 — hecha:** contratos (`shared/src/agente.ts`), motor de la cola (`sidecar/src/agente.ts`: requisitos configurables, prioridad por monedas, una gratis cada N segundos al azar, una pregunta por persona, crédito del regalo con caducidad), canal WS `agente`, `agente.json`, overlay `/overlay/agente` y pantalla «Agente IA». El `Responder` de fábrica es un texto de prueba: el motor ya acepta cualquier `Responder`.
- **Pieza 2 — hecha:** `ModelService` con adaptadores para la API compatible con OpenAI (DeepSeek, OpenAI, Gemini) y la de Claude, sin dependencias nuevas (`fetch`). Claves propias en `agente-keys.json` (aparte de `agente.json`; solo las lee el sidecar; a la app y al overlay solo llega si hay clave o no). «Probar conexión» hace una llamada mínima. Defensas en `agente-guard.ts`: se limpia la pregunta (sin marcado ni caracteres de control), un detector de intentos de inyección la rechaza sin gastar saldo, el prompt del sistema tiene reglas fijas y la pregunta va como dato entre etiquetas, y la respuesta se limpia (una línea, sin enlaces ni menciones; si trae una clave o parte del prompt, se cambia por la negativa). Límites: tope de llamadas por LIVE, espera por persona entre preguntas, 120 tokens de salida y 20 s de espera.
- **Fase (c), pieza 1 — voz del sistema, hecha:** el overlay lee cada respuesta con `speechSynthesis` (voces instaladas en el equipo, sin servicio externo ni coste). Configurable: activada, mujer/hombre, voz concreta, velocidad, volumen y leer también la pregunta. La elección de voz (`pickVoice`: solo español, nombre exacto, género por el nombre, español latino y voces «Online/Natural» primero) existe en TypeScript para la app y como JS para el overlay, y un test comprueba que eligen igual. En la vista previa de demo no habla. Límite conocido: el género se deduce del nombre de la voz; si el sistema solo tiene una voz en español, se usa esa.
- **Fase (b) — trivia + Top Trivia, hecha:** `TriviaEngine` (`agente-trivia.ts`). Sale sola cuando no hay comentarios ni regalos durante `idleSec` (y el agente no está ocupado), con tope por hora; el modelo devuelve un JSON (pregunta, opciones, correcta) que se valida (formato, largos, opciones sin repetir, sin enlaces ni intentos de inyección) y las opciones se barajan. La gente responde con la letra; una respuesta por persona; gana el primero que acierta. **La respuesta correcta no sale en el estado mientras la pregunta está abierta** (el overlay lo puede leer cualquiera); solo se manda al enseñar la respuesta. Premio: la próxima pregunta del ganador al agente pasa primero (monedas de prioridad configurables), aunque no cumpla los requisitos, y se salta la espera por persona; además suma un acierto en el nuevo ranking de fábrica **Top Trivia** (métrica `trivia` de los Tops, ADR 0017, del día). «Trivia de prueba» usa preguntas de ejemplo sin clave ni gasto. El overlay lee la pregunta y la respuesta en voz alta. Cada trivia cuenta como una llamada del modelo.
- **Fase (d) — avisos periódicos, hecha:** cada `everySec` (300 por defecto), si el agente no está respondiendo, no hay preguntas esperando ni una trivia abierta, el overlay muestra (y lee en voz alta) un aviso que explica cómo participar. Los de fábrica se arman con `buildTips` según la configuración (cómo preguntar y quién puede, que los regalos dan prioridad y, si está activada, la trivia) y se les suman hasta 5 propios. No usan el modelo, así que no gastan saldo. Una pregunta que entra los quita de pantalla.
- **Ajustes tras la primera prueba real (2026-10-20):** (1) el nombre del modelo ya no se escribe a mano: la app pide al proveedor su lista (`GET /models`, sin coste, solo con clave guardada; mensajes `list-models` / `models`), la filtra de lo que no es de chat y la enseña en un desplegable, con «Otro…» por si sale un modelo nuevo. No hay lista fija de modelos en el código; solo un modelo de respaldo por proveedor (DeepSeek: `deepseek-v4-pro`) para cuando no se ha elegido ninguno. Un 400/404 que habla del modelo sugiere elegir otro. (2) Un fallo del modelo (sin clave, modelo inexistente, sin saldo, tope de llamadas) **ya no se muestra al público**: la pregunta se retira y el motivo sale solo en la pantalla «Agente IA» (`state.lastError`) y en la consola del sidecar. (3) El overlay se puede dividir: `/overlay/agente/cola` (solo la barra) y `/overlay/agente/respuesta` (pregunta, trivia y avisos); `/overlay/agente` sigue mostrando todo junto. La voz solo suena desde las respuestas, para no duplicarla.
- **Voz humana en la nube (2026-10-21, Gemini TTS):** además de la voz del equipo (`voice.provider: "system"`, por defecto), el agente puede hablar con una voz generada por Gemini (`"gemini"`). El overlay no llama a Google: pide cada frase al sidecar por el canal `agente` (`tts` → `tts-audio`, WAV en base64) y la reproduce en orden; el sidecar usa la clave de Gemini ya guardada para el modelo (`agente-voz.ts`; la clave sigue sin salir del equipo). La voz, el estilo y el modelo de voz (`gemini-3.8-flash-tts` por defecto, editable porque Google renueva sus modelos) se eligen en la tarjeta Voz, donde «Probar voces» deja oír cada voz con una frase propia. El estilo va como anotación del turno y cada frase suma un ánimo (`calm`, `happy`, `excited`, `mystery`: alegre al agradecer o acertar la trivia). Defensas de gasto: memoria de audios ya generados (los «gracias» no se pagan dos veces), tope `maxCloudCalls` por LIVE (los fallos no cuentan), máximo 20 audios nuevos por minuto y 600 letras por frase; la voz solo se pide a quien la reproduce (no la vista previa de la app). Si Gemini falla, no hay clave o se llega al tope, la misma frase se dice con la voz del equipo (tras 3 fallos seguidos se deja la nube 2 min). La API se llama por `/v1beta/interactions` y, si esa ruta no existiera para la cuenta, se prueba la anterior (`generateContent`); la respuesta se busca sin depender de una sola forma y el PCM crudo se envuelve en WAV.
- **Ánimo del LIVE (2026-10-22):** el agente mide cuánto movimiento hay y ajusta su voz y su tono (`agente-animo.ts`, `LiveMoodEngine`). Cada evento del LIVE suma puntos a un acumulador que se apaga solo (vida media ~40 s): comentario 1.5, seguidor 5, compartido 6, suscripción 8, regalo = 0.3 por moneda (tope 500; un combo en curso suma 2 y el cierre trae las monedas), like 0.05 por toque (tope 30 por mensaje), entrada 0.2. La energía (0–100, saturante) cae en cuatro niveles —Tranquilo, Normal, Animado, A tope— con margen para no oscilar, y se traduce en un ánimo de voz (`calm` / `happy` / `excited`). Un regalo grande (≥150 monedas de una vez) sube el ánimo a «emocionada» 25 s de golpe. El ánimo llega a la voz (`tts` con `mood: "auto"`, el valor por defecto: lo elige el sidecar; una frase puede forzar el suyo, p. ej. la trivia) y al texto (una línea de contexto en el prompt de sistema, armada por el sidecar —nunca texto de un espectador—, solo en tranquilo, animado, a tope o tras un regalo grande). Configuración (`animo`): activado, sensibilidad 0.5–2× (mueve la escala y el umbral del regalo grande) y «cambiar también el tono del texto». Los pesos y umbrales son un primer ajuste: se probó con la grabación real (un LIVE muy tranquilo → casi siempre «Tranquilo») y con ráfagas simuladas; la pantalla enseña la energía para afinar la sensibilidad en un LIVE de verdad. El botón «Probar subidón» (`animo-test`) lo sube unos segundos.
- **Avisos a cada persona, estado de la fila y contexto del LIVE (2026-10-22):** el overlay enseña una línea de estado (respondiendo a…, pensando, trivia, libre) y «Sigue: …» con quien espera. El motor (`agente.ts`) publica `notices` en el estado —cortos, caducan solos (~12 s), máximo 4— que el overlay dibuja y, si `tips.speakThanks`, lee con la voz solo cuando no hay respuesta ni trivia en curso (y con una separación mínima entre frases): «tu pregunta está en la fila (N esperando)», «subió a Prioridad · lugar #k», «¡Gracias X! Eres Prioridad: escribe !ia y tu pregunta», y un gracias **agrupado** a los seguidores nuevos («A, B y C»; una sola frase por tanda). Se apagan con `tips.personal` / `thanksFollows` / `speakThanks` (tarjeta Avisos). Los nombres se limpian (sin @, 20 letras). Nada de esto llama al modelo. Las respuestas ya no se cortan a 150 letras: al modelo se le pide una respuesta interesante de dos o tres frases completas (~200 caracteres, nunca más de 400, hasta 300 tokens), el tope de seguridad es de 600 y, si se pasara, se corta al final de una frase; la voz la lee entera (hasta 6 trozos) y la respuesta se queda en pantalla lo que dura leerla (6–45 s). `liveContext` (500 letras, lo escribe el streamer) se añade al prompt de sistema como dato informativo, sin símbolos de etiqueta. El modelo de voz ya no se escribe a mano: `list-voice-models` → `voice-models` pide a Gemini sus modelos con «tts» en el nombre (`GET /v1beta/models`, sin coste) y la tarjeta Voz los ofrece en un desplegable con «Otro…».
- Fases posteriores: reacciones propias con poco movimiento y a metas cumplidas, conversación por micrófono, ElevenLabs y «Mi voz».
