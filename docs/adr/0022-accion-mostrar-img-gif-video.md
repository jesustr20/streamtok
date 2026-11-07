# ADR 0022 — Acción «Mostrar IMG / GIF / VIDEO»

Estado: aceptado (2026-11-07).

## Contexto

La Acción general «Mostrar IMG / GIF / VIDEO» era solo una casilla informativa. Interactive la resuelve con un panel (tamaño, duración, volumen, subir archivo) y tres orígenes: archivos locales, archivos web e imágenes de la app, y muestra el resultado en una «pantalla» que se pega como fuente web en TikTok LIVE Studio.

## Decisión

Mismo patrón que Play Audio (ADR 0019):

- **Comando interno** `app.media.show` (ADR 0011) con `MediaShowParams`: `source` (`local`|`web`), `file` o `url`, `screen` (1–9), `sizePct` (10–100, relativo a la pantalla del overlay), `durationSec` (0 = automática: imagen 5 s, video hasta que termine) y `volume` (solo videos). Se valida con su propio esquema en `validateAcciones`.
- **Sidecar** `MediaController`: carpeta `%APPDATA%\StreamTok\media` (JPG, PNG, WEBP, AVIF, GIF, MP4, WEBM, MOV; hasta 50 MB; se comprueban los primeros bytes), lista de enlaces web `enlaces.json`, canal WS `media` (`get-state`, `state`, `upload`, `delete`, `add-web`, `delete-web`, `open-folder`, `show`, `error`). Los archivos se sirven en `/media/<nombre>` con soporte de `Range`.
- **Overlay** `/overlay/pantalla/<n>`: página transparente que escucha `media/show` de su pantalla y dibuja el medio. Una cola por pantalla. Si el navegador bloquea el video con sonido, se reintenta en silencio. No forma parte de `OverlayKind` (no tiene diseños ni estilo).
- **UI** `PlayMediaPanel` dentro de `AccionModal`: tamaño, duración, volumen, pantalla con su URL para copiar y pestañas **Archivos locales**, **Archivos web** (URL + nombre + «+») e **Imágenes App** (marcada «Próximamente»: no existe aún una fuente de imágenes por juego).

## Consecuencias

- El streamer pega `/overlay/pantalla/1` una sola vez en LIVE Studio; varias pantallas permiten varias posiciones.
- Los MKV/AVI no se admiten (Chromium/WebView2 no los reproduce de forma fiable).
- Los enlaces web se cargan directamente desde internet en el overlay: no se descargan ni se verifica su contenido.
- «Imágenes App» queda pendiente hasta definir de dónde salen las imágenes de cada juego.
