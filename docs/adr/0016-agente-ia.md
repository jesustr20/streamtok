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
- Fases posteriores: voces más humanas en la nube y «Mi voz», relleno y explicaciones periódicas.
