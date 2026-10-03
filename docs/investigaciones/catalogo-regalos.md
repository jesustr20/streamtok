# Investigación: catálogo real de regalos de `tiktok-live-connector`

Issue: #31 · Rama: `issue-31-investigar-catalogo-regalos`

Objetivo: confirmar qué expone `tiktok-live-connector@2.5.0` (la versión pineada en el
repo) para obtener el catálogo de regalos de una sala LIVE, y con qué shape exacto,
para poder reemplazar el campo de texto libre de "Enviando un regalo específico" por
un combo real (imagen + nombre + costo).

> Alcance: **solo investigación**. No se implementó UI ni se cambió ningún schema
> (`mod-protocol.ts` / `live-event.ts` / `action.ts` / `event.ts` quedaron intactos).

---

## 1. Métodos / opciones: lo que SÍ existe

Verificado leyendo el código fuente real del paquete
(`packages/sidecar/node_modules/tiktok-live-connector/dist/`, no solo el README):

| Elemento | ¿Existe? | Detalle |
|---|---|---|
| `fetchAvailableGifts()` | ✅ SÍ (método) | `TikTokLiveConnection#fetchAvailableGifts(): Promise<RoomGiftInfo>` |
| `getAvailableGifts()` | ❌ NO | No hay ningún método con ese nombre; solo la **propiedad** `availableGifts`. |
| `enableExtendedGiftInfo` | ✅ SÍ (opción) | Opción del constructor, `default: false`. |
| Propiedad `availableGifts` | ✅ SÍ | Cache del catálogo (`RoomGiftInfo \| null`). |

Método exacto a usar para el combo:

```ts
const connection = new TikTokLiveConnection('@username');   // opciones: { signApiKey?, enableExtendedGiftInfo? }
await connection.fetchRoomId();          // (1) resuelve y cachea el roomId — OBLIGATORIO antes
const gifts = await connection.fetchAvailableGifts();      // (2) trae data.gifts
// gifts === connection.availableGifts (la misma referencia que usa el cache)
```

### Qué hace exactamente `fetchAvailableGifts()`

Cadena real (leída en `dist/lib-DWhiWLli.js`):

- `fetchAvailableGifts()` → `RouteConfig.fetchRoomGifts({ roomId: this.roomId, webClient })`
  (`lib-DWhiWLli.js:1919-1924`).
- `fetchRoomGiftsRoute` → `webClient.getJsonObjectFromWebcastApi("gift/list/", { ...clientParams, room_id: roomId }, true).data.gifts`
  (`lib-DWhiWLli.js:1028-1034`).

Es decir: pega al endpoint firmado de TikTok `webcast/gift/list/` con `room_id`, y
devuelve **`data.gifts` tal cual, sin transformar**. La request se firma
(`signRequest: true`) contra Euler Stream.

### Shape devuelto

`fetchAvailableGifts()` está tipado como **`any`**:

```ts
// dist/index-DcaLUrMQ.d.ts
type RoomGiftInfo = any;          // línea 246
type RoomGiftsResponse$1 = any;   // línea 972 (el data.gifts de la ruta webcast)
```

Por lo tanto el connector **no documenta el shape completo en tipos**. Lo único
confirmable desde el código + README del propio paquete es:

- `gift.id` — usado en `lib-DWhiWLli.js:2033` para matchear (`x.id === data.giftId`).
- `gift.name` — ejemplo del README (`gift.name`).
- `gift.diamond_count` — ejemplo del README (`gift.diamond_count`).

El ejemplo oficial del README (`README.md:1166-1170`):

```ts
connection.fetchAvailableGifts().then((giftList: RoomGiftInfo) => {
    console.log(giftList);
    giftList.forEach(gift => {
        console.log(`id: ${gift.id}, name: ${gift.name}, cost: ${gift.diamond_count}`)
    });
});
```

### `enableExtendedGiftInfo` (opción)

- `default: false`. Si es `true`, durante `connect()` se ejecuta
  `this._availableGifts = await this.fetchAvailableGifts()`
  (`lib-DWhiWLli.js:1818`), y cada `WebcastGiftMessage` entrante lleva el campo
  `extendedGiftInfo` = el item del catálogo matcheado por `x.id === data.giftId`
  (`lib-DWhiWLli.js:2033`).
- `extendedGiftInfo` también está tipado como `any`
  (`dist/index-DcaLUrMQ.d.ts:280`).

---

## 2. Prueba en vivo — NO COMPLETADA (sin cuenta LIVE real)

**No pude ejecutar la prueba en vivo** porque el entorno no tiene una cuenta TikTok
LIVE real ni credenciales:

- No hay `TIKTOK_USERNAME` configurado en el repo (el sidecar solo lo lee de env,
  ver `packages/sidecar/src/index.ts:88`).
- No hay `signApiKey` configurada en ningún lado (el repo conecta sin key, usando el
  nivel gratuito de Euler Stream).

Dejé un script listo para correr la prueba cuando se tenga una cuenta LIVE:

- `scripts/investigacion/fetch-gifts.mjs`

Uso:

```bash
cd packages/sidecar
TIKTOK_USERNAME=tu_usuario_en_vivo node ../../scripts/investigacion/fetch-gifts.mjs
# opcional: SIGN_API_KEY=... para subir rate limits
```

El script imprime `JSON.stringify(gifts, null, 2)` **sin transformar**. Con el JSON
que salga de ahí se puede completar la sección "shape real" y terminar el combo.

> Por eso, en esta sección **no pego un "JSON de ejemplo" inventado**: pegar un JSON
> que no salió de una corrida real violaría el requerimiento de "sin inventar campos".
> Lo que puedo afirmar sin mentir está en la sección 1 (id / name / diamond_count) y en
> el apartado siguiente (shapes tipados del SDK).

---

## 3. Campos por regalo: lo confirmado vs lo pendiente

**Confirmado desde el código del connector** (no es el JSON completo, solo campos puntuales):

- `id` (matchea `data.giftId` del mensaje de regalo).
- `name`.
- `diamond_count` (costo).

**No confirmado / pendiente de la corrida en vivo**: el resto del shape de
`data.gifts` (URLs de imagen, `icon`/`image`, `type`, `combo`, etc.). El connector lo
deja en `any`, así que solo la corrida en vivo (o el contrato del endpoint
`webcast/gift/list/` de TikTok) lo fija.

### Referencia tipada adicional (del SDK `tiktok-live-api-sdk@0.4.0-beta1`)

El SDK de Euler Stream (dependencia del connector) SÍ tipa varios endpoints de regalos.
Sirve para saber qué campos maneja TikTok en general, pero **no es** lo que devuelve
`fetchAvailableGifts()`:

- `TikTokGiftsServerGift` (camelCase) — `giftId, giftName, giftType, diamondCount,
  combo, forLinkMic, describe, duration, imageUri, updatedAt`. (endpoints de gift
  search/catalog del SDK).
- `NormalGiftItem` (snake_case) — `gift_id, name, coin_price, image_url,
  unlighted_image_url, gallery_gift_tag_url, …`. (galería de regalos:
  `WebcastGiftGalleryResponse.data.normal_gifts`).
- `RoomGiftsResult` — `room_id, page_gifts: number[], gift_overrides: {...}` (el
  endpoint Euler de "room gifts" NO trae nombres/imágenes, solo IDs de regalos).

Otras rutas exportadas relevantes (por si el combo necesita imágenes que
`fetchAvailableGifts()` no incluya):

- `fetchRoomGiftGalleryFromEulerRoute` (Euler) → `WebcastGiftGalleryResponse`
  (`data.normal_gifts[]` con imagen).
- `fetchRoomGiftsFromEulerRoute` (Euler) → `RoomGiftsResponse` (IDs + overrides).

---

## 4. Región / idioma

- `fetchAvailableGifts()` (ruta webcast de TikTok) **no recibe parámetro de idioma**.
  El idioma sale de `webClient.clientParams`, que se arma a partir de
  `clientPresets.location`: `app_language`/`webcast_language = location.lang`,
  `browser_language = location.lang_country`, más `region`, `priority_region`,
  `tz_name` (`lib-DWhiWLli.js:314-328, 1378-1391`).
- `clientPresets` por defecto es **aleatorio** (`getRandomPresets()`), y la lista
  `Locations` del connector solo trae variantes **en inglés** (`en-GB`, `en-CA`,
  `en-AU`, `en-NZ`, `en-ZA`, `en-IE`, `en-JM`, `en-BZ`, `en-TT`).
- Para forzar un idioma (ej. español), dos opciones:
  1. Mutar `connection.clientParams.webcast_language = "es"` antes de llamar
     `fetchAvailableGifts()` (los params son mutables, README "clientParams").
  2. Pasar `clientPresets` con un `location` propio con `lang`/`lang_country`.
- La ruta Euler `fetchRoomGiftsFromEulerRoute` **sí** acepta `webcastLanguage` como
  parámetro explícito ("Optional language used to localize the returned gift names
  and descriptions").

Conclusión: sí depende de región/idioma, pero no de "la región de la cuenta
conectada" sino del `location` (preset) que se use en el cliente HTTP. El idioma de
los nombres se controla por `webcast_language` en los query params.

---

## 5. ¿Requiere `connect()` activo?

- `fetchAvailableGifts()` **no requiere una conexión WS activa**, pero **sí requiere
  `roomId`**. Si `this.roomId` está vacío, la ruta lanza `InvalidRequestError
  ("Missing roomId...")` (`lib-DWhiWLli.js:1029`).
- `roomId` se resuelve de dos formas:
  - `connect()` (lo resuelve y cachea durante la conexión), o
  - `fetchRoomId()` **sin conectar** (lo resuelve vía HTML scrape → API → Euler y lo
    cachea en `webClient.roomId`; el getter `roomId` devuelve `webClient.roomId`).
- Importante: a diferencia de `fetchRoomInfo()` (que auto-resuelve el roomId),
  `fetchAvailableGifts()` **NO** llama a `fetchRoomId()` por sí solo — hay que
  resolverlo antes. Flujo sin conectar:

```ts
const c = new TikTokLiveConnection('@username');
await c.fetchRoomId();          // cachea roomId
const gifts = await c.fetchAvailableGifts();
```

- La request es firmada vía Euler Stream. Es gratis con límites de comunidad (no hace
  falta API key); `signApiKey` solo sube los límites (README "Is it free?").
- `enableExtendedGiftInfo: true` sí va atado a `connect()`: se dispara **después** de
  la verificación de "streamer en vivo" (`UserOfflineError` si no está live,
  `lib-DWhiWLli.js:1814-1818`), así que con esa opción se necesita un LIVE activo.

---

## Limitaciones encontradas

1. `fetchAvailableGifts()` devuelve **`any`**: no hay tipado del shape en el
   connector; el JSON real hay que capturarlo en vivo.
2. **No pude correr la prueba en vivo** (sin `TIKTOK_USERNAME` de una cuenta LIVE, ni
   `signApiKey`). El JSON crudo queda pendiente de esa corrida.
3. El endpoint devuelve el catálogo **por sala** (`room_id`), y los nombres salen
   localizados según el `location` preset (por defecto inglés y aleatorio).
4. Hay una vía alternativa tipada (Euler) por si se necesitan imágenes:
   `fetchRoomGiftGalleryFromEulerRoute` (`NormalGiftItem` con `image_url`), pero es
   endpoint "premium" de Euler y requiere sesión/room del creador.

## Checklist Regla #4 (que nada se rompió)

```bash
pnpm --filter @streamtok/shared exec tsc --noEmit -p .       # OK
pnpm --filter @streamtok/sidecar exec tsc --noEmit -p .      # OK
pnpm --filter @streamtok/sidecar test                         # OK (85 tests)
pnpm --filter @streamtok/desktop exec tsc -p tsconfig.json --noEmit  # OK
```

No se tocó ningún schema ni código de producción: solo se agregó
`scripts/investigacion/fetch-gifts.mjs` y este reporte.
