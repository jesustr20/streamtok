# ADR 0014 — Alertas de comunidad y nivel (overlay `nivel`)

- Estado: propuesto
- Fecha: 2026-10-17
- Relacionado: ADR 0007 (niveles de fan y donador), ADR 0012 (overlays con varias instancias), ADR 0013 (fotos de perfil)

## Contexto

Interactive ("Subida de nivel": Nivel Fans, Nivel Donador, Nivel Rotativo) y TikControl (carruseles, "Subida de nivel", animación "Quiéreme") muestran un aviso en pantalla cuando alguien se une a la comunidad o sube de nivel. StreamTok ya detecta las subidas (`fanLevelUp`, `donorLevelUp`, ADR 0007) pero solo como disparador de Acciones, y ya trae la foto de perfil en `avatarUrl` (ADR 0013).

TikTok no manda un mensaje de "nuevo miembro del Fan Club". En el LIVE, la gente se une con el regalo **Heart Me** (en español, "Quiéreme").

## Decisión

1. **Nuevo tipo de overlay `nivel`**, con instancias (`/overlay/nivel/<id>`) como las Metas. De fábrica: `comunidad` (se une + sube de nivel de fan), `donador` (sube de nivel de donador) y `todas` (los tres avisos). Cada una con diseño (pastilla con foto, tarjeta, texto), frase editable, segundos en pantalla y nivel mínimo.
2. **Nuevo canal WS `alertas`** (`get-state`, `state`, `alert`, `save`, `set-join-gifts`, `test`, `error`) y archivo `alertas.json` (escritura atómica). Es un canal propio, igual que `goals` y `room`.
3. **No se toca `live-event.ts` ni `mod-protocol.ts`.** El sidecar deriva el aviso de eventos existentes:
   - `fanLevelUp` / `donorLevelUp` → aviso de subida de nivel.
   - Un `gift` cuyo nombre coincide con la lista `joinGiftNames` (por defecto "heart me", "quiéreme", "quiereme") → aviso "se unió a la comunidad". Cada usuario avisa una vez por LIVE (se reinicia al conectar).
4. Para que la subida de nivel lleve la foto, los eventos `fanLevelUp`/`donorLevelUp` ahora incluyen `avatarUrl` (campo ya existente y opcional).
5. En la vista previa de la app, el overlay corre en modo demostración (avisos de ejemplo); el overlay real solo muestra avisos del LIVE, en cola.

## Riesgos y supuestos por validar

- **Detección de "se unió" por nombre de regalo.** Supone que el regalo de entrada a la comunidad se llama "Heart Me" en el catálogo del streamer. Si en su cuenta se llama distinto, se corrige en la lista de nombres (campo editable en la pantalla). Falta validarlo con una grabación real de un LIVE donde alguien se una.
- "Captura de regalos" (cuarta pestaña de Interactive) no se vio en acción; queda fuera hasta confirmarla.
- Las URLs de avatar caducan; si la imagen falla se muestra la inicial.

## Alternativas descartadas

- Añadir un tipo `fanJoin` a `LiveEvent`: es un cambio de contrato y hoy no hay evidencia de un mensaje propio de TikTok para ello.
- Detectar la unión por la primera aparición de la insignia de Fan Club: el rastreador de niveles ignora a propósito la primera vez que ve a un usuario (ADR 0007) y daría falsos positivos con quien ya era miembro.
