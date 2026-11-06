# ADR 0019 — Módulo de audio: la acción "Play Audio" y la lista de audios

- Estado: propuesto
- Fecha: 2026-11-06
- Relacionado: ADR 0011 (comandos internos `app.*`), ADR 0004 (Acciones)

## Contexto

El modal de Acción traía "Play Audio" como una casilla sin función. Referencia: Interactive (acción general con volumen, lista de audios y tres opciones de reproducción). El streamer quiere que un evento (regalo, seguidor, comando…) haga sonar un efecto corto y que él pueda elegirlo de una lista, subir sus propios archivos y, en una siguiente parte, bajarlos de MyInstants.

## Decisión

1. **Comando interno `app.audio.play`** dentro de la Acción (prefijo `app.`, como Timer/Metas/Wins). Parámetros: `file` (nombre en la carpeta), `volume` (0–100, 50 por defecto), `oneShot`, `skip`, `queue` (booleanos). Como el catálogo de comandos internos solo describe int/enum/bool y aquí hay un nombre de archivo, `validateAcciones` lo valida con su propio esquema (`AudioPlayParamsSchema`) y completa los valores por defecto. En la UI no sale en el selector de Timer/Wins: tiene su panel en "¿Qué deseas realizar?".
2. **Carpeta de audios** `%APPDATA%\StreamTok\audios` (la misma base que el resto de archivos de la app). "Abrir carpeta" la abre en el explorador; lo que el streamer copie a mano ahí aparece en la lista. Se admiten `.mp3`, `.wav` y `.ogg` de hasta 10 MB (son efectos cortos); al subir se revisan los primeros bytes (que un `.mp3` sea de verdad un mp3) y un nombre repetido no pisa al anterior (`nombre (2).mp3`).
3. **Dónde suena: en la app de escritorio**, no en un overlay. El sidecar no reproduce nada: manda `play` por el canal WS `audio` y la app (un reproductor montado en la raíz, vale estés en la pantalla que estés) suena el archivo, que LIVE Studio captura como audio del PC. Los archivos se sirven por el servidor HTTP de overlays en `/audios/<nombre>` (solo loopback; el nombre no puede llevar rutas).
4. **Opciones de reproducción** (`AudioScheduler` en shared, probado sin navegador):
   - *One-Shot*: si ese audio ya suena (o espera en la cola), el disparo se ignora.
   - *Saltar audio*: corta todo lo que suena, vacía la cola y suena este (manda sobre One-Shot y Cola; la UI no deja marcar Saltar y Cola a la vez).
   - *Añadir a la cola*: si algo suena, espera a que termine y entra en orden.
   - Sin opciones, varios audios suenan a la vez.
5. **Canal WS `audio`**: `get-state`/`state` (lista, ruta de la carpeta y puerto HTTP), `upload` (base64), `delete`, `open-folder`, `play`, `error`. El botón "Probar" del panel manda `play` por el mismo camino que una Acción.
6. **Lista de audios** (modal): audios locales con buscador, orden, volumen de prueba, ▶ escuchar, ✓ elegir, ✕ borrar (con confirmación), subir archivo o soltarlo. Las pestañas "Audios públicos" y "MyInstants" se muestran como próximamente.

## Pendiente (siguientes partes)

- Pestaña **MyInstants**: buscar, paginar y "agregar por URL" (baja el MP3 de la página del sonido y lo guarda en la carpeta). Requiere leer la API oficial de MyInstants o su HTML; falta revisar sus términos.
- Qué es la pestaña "Audios públicos" de Interactive para nosotros.

## Riesgos

- **Sonido bloqueado por el navegador embebido** hasta que haya un clic en la app (política de autoplay). Si pasa, la app muestra un aviso para que haga clic y reintente. Por validar en la app real.
- **Si la app de escritorio está cerrada, no suena nada** (el sidecar no reproduce). El motor igual cuenta la acción como ejecutada.
- **Derechos de autor**: los sonidos de MyInstants suelen ser clips con copyright. Son efectos de pocos segundos, de uso común en LIVEs; la responsabilidad es del streamer.
- El audio mezclado depende de que LIVE Studio capture el audio del PC; el volumen se controla en la acción y en el mezclador de LIVE Studio.
