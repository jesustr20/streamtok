import { join } from "node:path";
import type { LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine } from "./acciones-eventos-engine.js";
import { EventRecorder, maxBytesFromEnv } from "./event-recorder.js";
import {
  GiftCatalogController,
  GiftCatalogStore,
  defaultGiftCatalogFilePath,
} from "./gift-catalog.js";
import { appDataDir } from "./mapping-rules.js";
import { ModBridge } from "./mod-bridge.js";
import { registerManualCommand } from "./manual-command.js";
import {
  ProfilesController,
  ProfilesStore,
  defaultProfilesFilePath,
} from "./profiles.js";
import { TiktokConnectionController } from "./tiktok-connection.js";
import { TikTokLiveSource } from "./tiktok-source.js";
import { StreamTokWsServer } from "./ws-server.js";

const PORT = 7331;

const server = new StreamTokWsServer(PORT);
const modBridge = new ModBridge(server);

modBridge.on("log", (entry) => {
  const tag = `[mod:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message);
});

// El fan-out de mod-hello/mod-ack a otros clientes (la UI del desktop, que
// se conecta como un cliente normal de este mismo WS) y el reenvío del
// catálogo cacheado a quien se conecte tarde ya lo maneja ModBridge — la UI
// escucha exactamente los mismos canales "mod-hello"/"mod-ack" que usa el
// mod, sin un canal aparte inventado para ella.

server.on("listening", (port) => {
  // eslint-disable-next-line no-console
  console.log(`StreamTok sidecar escuchando en ws://localhost:${port}`);
});

// ---------------------------------------------------------------------------
// Motor genérico de Acciones y Eventos + perfiles (ADR 0004 / ADR 0002). El
// sidecar carga los perfiles (migrando mapping-rules/community-rules viejos si
// hace falta) y deja el motor corriendo las acciones/eventos del perfil activo.
// La UI gestiona perfiles por "profiles" y edita acciones/eventos por
// "acciones"/"eventos".
// ---------------------------------------------------------------------------
const engine = new AccionesEventosEngine(modBridge);

const profilesStore = new ProfilesStore(defaultProfilesFilePath());
const profilesController = new ProfilesController(
  server,
  profilesStore,
  engine,
  () => modBridge.getCatalog(),
);
profilesController.on("log", (entry) => {
  const tag = `[profiles:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});

// ---------------------------------------------------------------------------
// Catálogo de regalos aprendido (issue #35). Se llena de forma incremental con
// los regalos que llegan por eventos reales del LIVE y se sirve a la UI por el
// canal `gift-catalog` (patrón get-state como `profiles`).
// ---------------------------------------------------------------------------
const giftCatalogController = new GiftCatalogController(
  server,
  new GiftCatalogStore(defaultGiftCatalogFilePath()),
);
giftCatalogController.on("log", (entry) => {
  const tag = `[gift-catalog:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});

// ---------------------------------------------------------------------------
// Canal "manual-command" (UI → sidecar): dispara un mod-command puntual (botón
// "Probar acción" de la UI) reusando ModBridge.sendCommand. No toca el
// protocolo del mod.
// ---------------------------------------------------------------------------
registerManualCommand(server, modBridge);

// ---------------------------------------------------------------------------
// Fuente de LiveEvents. En producción esto viene de tiktok-live-connector
// (ver README del sidecar); por ahora solo se re-emite lo que llegue por el
// canal "live-event" (útil para el Simulador de la UI: manda eventos falsos
// por WS y el sidecar los procesa exactamente igual que si fueran reales).
// ---------------------------------------------------------------------------
server.onChannel("live-event", (payload) => {
  const evt = payload as LiveEvent;
  engine.handleEvent(evt).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Error procesando live-event:", err);
  });
});

// ---------------------------------------------------------------------------
// Conexión real a TikTok LIVE. La UI (pantalla Inicio) la arranca/para por el
// canal "tiktok-connection". Los eventos normalizados alimentan a
// `engine.handleEvent` exactamente igual que los que llegan por el canal
// "live-event" del Simulador, y los regalos alimentan el catálogo aprendido.
// Cada conexión graba TODOS los mensajes crudos en un archivo aparte
// (recordings/, ver event-recorder.ts). Si el LIVE no está disponible no se
// cae el proceso: la UI recibe el error por el canal.
// ---------------------------------------------------------------------------
const tiktokConnection = new TiktokConnectionController(server, {
  createRecorder: (username) =>
    new EventRecorder({
      dir: join(appDataDir(), "recordings"),
      label: username,
      maxBytes: maxBytesFromEnv(process.env),
      // STREAMTOK_RECORD_FULL=1 guarda todo sin adelgazar ni deduplicar.
      compact: process.env.STREAMTOK_RECORD_FULL !== "1",
      // eslint-disable-next-line no-console
      onLog: (message) => console.log("[recorder]", message),
    }),
  createSource: (username, recorder) => new TikTokLiveSource(username, recorder),
  onEvent: (evt) => {
    engine.handleEvent(evt).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Error procesando live-event (TikTok):", err);
    });
  },
  onGift: (entry) => giftCatalogController.learn(entry),
  onConnected: () => engine.resetSession(),
});
tiktokConnection.on("log", (entry) => {
  const tag = `[tiktok:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});

// Cierra la grabación completa al terminar el proceso (Ctrl+C / cierre de la app).
const shutdown = () => {
  tiktokConnection.disconnect().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Opcional (sin UI, p. ej. para pruebas): conectar al arrancar.
const tiktokUsername = process.env.TIKTOK_USERNAME?.trim();
if (tiktokUsername) {
  void tiktokConnection.connect(tiktokUsername);
}

export { modBridge, server, engine };
