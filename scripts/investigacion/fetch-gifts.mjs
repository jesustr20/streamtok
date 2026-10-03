// Investigación issue #31 — catálogo real de regalos de tiktok-live-connector.
//
// Este script NO es código de producción: es una herramienta suelta para
// confirmar el shape crudo de `fetchAvailableGifts()` contra una cuenta LIVE
// real. Se ejecuta a mano, nunca desde la app.
//
// Requisitos:
//   - TIKTOK_USERNAME  (obligatorio)  @usuario de una cuenta que esté EN VIVO.
//   - SIGN_API_KEY     (opcional)     API key de Euler Stream (sube rate limits;
//                                     sin key usa el nivel gratuito).
//
// Cómo correrlo (desde la raíz del repo, con pnpm install hecho):
//   cd packages/sidecar
//   node ../../scripts/investigacion/fetch-gifts.mjs
//
// El import relativo apunta al node_modules del workspace `@streamtok/sidecar`,
// que es donde vive `tiktok-live-connector` (dependencia de ese package).

import { TikTokLiveConnection } from "../../packages/sidecar/node_modules/tiktok-live-connector/dist/index.js";

const username = process.env.TIKTOK_USERNAME?.trim();
if (!username) {
  console.error("Falta TIKTOK_USERNAME. Ej.: TIKTOK_USERNAME=tu_usuario node ...");
  process.exit(1);
}

const connection = new TikTokLiveConnection(username, {
  // opcional: sube los límites de la comunidad (gratis)
  ...(process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {}),
});

try {
  console.error(`Resolviendo roomId para @${username}…`);
  const roomId = await connection.fetchRoomId();
  console.error(`roomId = ${roomId}`);

  console.error("Pidiendo catálogo de regalos (fetchAvailableGifts)…");
  const gifts = await connection.fetchAvailableGifts();

  // Respuesta CRUDA, sin transformar ni resumir.
  console.log(JSON.stringify(gifts, null, 2));
} catch (err) {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
} finally {
  await connection.disconnect().catch(() => {});
}
