# 0006. Catálogo de acciones offline, persistido y auto-sincronizado

- Estado: accepted
- Fecha: 2026-10-02
- Issue: #N (se completa al abrir el issue)

## Contexto

Hoy `App.tsx` arranca con `catalog = null` y solo se llena cuando llega un
`mod-hello` real por WS — sin el juego/mod abiertos no hay catálogo, y no se
pueden crear/mapear Acciones de antemano.

Confirmado con el repo `streamtok-mod-gtav`: cada Release va a publicar un
`catalog.json` (mismo shape que `ModHelloPayloadSchema` — `{ mod, version,
actions[] }`, generado directo del código C#, no a mano) como asset extra
junto al `.zip` del `.dll`.

Cómo se persiste esto localmente es caro de revertir después: si más
adelante hay mapeos evento→acción guardados por el usuario referenciando
`action.id`, la forma en que se guarda y reemplaza el catálogo determina si
esos mapeos sobreviven una actualización del mod o se rompen en silencio.

## Opciones consideradas

1. **Solo en memoria por sesión** (lo que hay hoy) — simple, pero obliga a
   tener el mod corriendo para ver o editar Acciones. Descartada, es
   justo el problema a resolver.
2. **JSON en disco, siempre vivo, se pisa solo** — un archivo
   `catalog.json` en `cache_dir()` (ya existe esa función en
   `github_release.rs`, junto al `.dll`). La app lo lee al arrancar
   (catálogo disponible sin el juego abierto), lo refresca contra el
   último Release de GitHub en background, y lo vuelve a pisar con el
   payload real cuando llega un `mod-hello` en vivo (esa es la fuente más
   autoritativa: es literalmente lo que el mod que corre ahora mismo
   dice que soporta).
3. **Base de datos (sqlite)** — overkill para un solo documento que no se
   consulta con queries relacionales; se descarta por ahora.

## Decisión

Opción 2. Un solo archivo `catalog.json` en `cache_dir()`, tratado como
cache reemplazable, no como fuente de verdad propia:

- **Fuente de verdad real**: el Release de GitHub (`catalog.json` del
  mod) y, mientras el mod esté conectado, el `mod-hello` en vivo — ese
  JSON en disco es solo la última copia conocida de cualquiera de los
  dos.
- **Al arrancar la app**: leer el cache si existe (catálogo disponible
  de inmediato) y, en paralelo, intentar bajar el último Release; si hay
  uno más nuevo, pisar el archivo y notificar al frontend.
- **Al conectar el mod en vivo**: el payload de `mod-hello` siempre pisa
  el cache (sin red, sin esperar al próximo Release) — es la versión
  exacta de la DLL que está corriendo ahora.
- **Conflicto de versión**: no se bloquea nada ni se pide confirmación —
  siempre gana el más reciente visto (Release nuevo > cache viejo;
  mod-hello en vivo > cualquier cache). Si en el futuro hay mapeos
  guardados por `action.id` y el id ya no existe en el catálogo nuevo,
  ese mapeo queda huérfano y se señala en la UI (no se borra solo) — pero
  eso es un issue aparte, no bloquea esta decisión.
- El archivo nunca se trata como opaco: tanto Rust como TS lo validan
  siempre con `ModHelloPayloadSchema` (`@streamtok/shared`) antes de
  usarlo — si el shape no calza, se descarta el cache y se pide
  recargar, nunca se corrompe en silencio.

## Consecuencias

- Queda fácil: Acciones se pueden ver/mapear sin GTA V abierto; la lista
  se actualiza sola la próxima vez que haya Release o conexión en vivo,
  sin intervención manual.
- Queda más difícil (deuda aceptada): si GitHub no es alcanzable y nunca
  hubo una conexión en vivo previa, no hay catálogo — se acepta por ahora,
  se podría empaquetar un catálogo de fallback en el instalador después
  si hace falta.
- Pendiente para un issue aparte, no esta decisión: qué hacer con un
  mapeo guardado cuyo `action.id` desaparece en una actualización.
