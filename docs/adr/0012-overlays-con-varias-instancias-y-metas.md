# 0012. Overlays con varias instancias; primer motor: Metas

- Estado: proposed (Jesús pidió ampliar el catálogo "a tu criterio"; revisar al mergear)
- Fecha: 2026-10-16
- Issue: —

## Contexto

El ADR 0011 dejó dos overlays fijos (Timer y Wins) servidos en `/overlay/<tipo>`.
Queremos crecer con ideas vistas en TikFinity, Interactive y TikControl (metas,
batallas propias, juegos, tops, alertas…) como overlays **sueltos**, sin packs.
Muchos de esos overlays se usan **varias veces** (dos metas distintas: likes y
monedas; dos duelos…), así que "un overlay = un tipo" ya no alcanza.

Es caro de revertir porque fija la forma de las URLs, el contrato UI↔sidecar de
los overlays nuevos y cómo se persisten. Solo añade archivos NUEVOS en `shared`;
**no toca `mod-protocol.ts` ni `live-event.ts`** (no hay datos nuevos de TikTok).

## Decisión

1. **Instancia = tipo + id.** La URL es `/overlay/<tipo>/<id>` (el servidor ya
   toleraba ese segmento). Timer y Wins siguen siendo únicos (`/overlay/timer`).
2. **Pocos motores, muchos overlays.** Cada familia de overlays comparte un motor
   en el sidecar (metas/contadores, acumuladores por usuario, duelos de dos
   lados, disparadores visuales sin estado). Un overlay nuevo es normalmente una
   configuración + diseños sobre un motor existente, no código nuevo.
3. **Un canal WS por motor** (`goals`, luego `duels`…), mismo patrón que `overlays`:
   `get-state`, `state`, mensajes de control, `error`. Las páginas solo LEEN.
4. **Persistencia propia por motor** (`goals.json`), escritura atómica, para no
   engordar `overlays.json` ni acoplar motores entre sí.
5. **Tipo × tema.** Cada tipo ofrece varios diseños (CSS por
   `body[data-design]`), igual que Timer/Wins; el color y el tamaño son del estilo.
6. **Primer motor: Metas** (`/overlay/meta/<id>`). Una meta cuenta una métrica
   (monedas, regalos, likes, follows, shares, suscripciones, comentarios), opcionalmente
   de un regalo concreto, hacia un objetivo; al cumplirse puede quedarse, subir el
   objetivo (`grow`) o reiniciarse (`reset`).

7. **Listas para usar.** Las metas vienen creadas la primera vez (likes, seguidores,
   compartidos, monedas, super fans, regalos; marca `seeded` en `goals.json` para que
   una borrada no reaparezca). El overlay por defecto es una pastilla con icono y el
   texto dentro; barra, círculo y texto son alternativas.
8. **Metas rotativas.** El id reservado `rotativa` muestra, una a una (cada 6 s), las
   metas con `rotate`. No hay configuración propia: el interruptor vive en cada meta.
9. **Acciones al finalizar.** Cada meta puede ejecutar Acciones al cumplirse
   (`onReachAccionIds`), igual que el timer al expirar.
10. **Sin espectadores.** Interactive tiene una meta de espectadores; aquí no se hace
    porque `LiveEvent` no trae ese dato (cambiarlo requiere otro ADR).

## Consecuencias

- Los motores no comparten código de conteo de combos todavía; si aparece un
  segundo motor que lo necesite se extrae (hoy el de Metas replica la lógica
  de `OverlayCounters`, cubierta por tests).
- Sin datos de espectadores, avatares ni batallas reales de TikTok: los duelos
  serán "propios" (regalo vs regalo, usuario vs usuario) hasta que se apruebe
  ampliar `LiveEvent` (otro ADR).
- Las páginas nuevas siguen siendo HTML autocontenido servido por el sidecar.
