import type { LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine } from "./acciones-eventos-engine.js";
import { ModBridge } from "./mod-bridge.js";
import { registerManualCommand } from "./manual-command.js";
import {
  ProfilesController,
  ProfilesStore,
  defaultProfilesFilePath,
} from "./profiles.js";
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

// TODO(ui): arrancar/parar esta conexión cuando el usuario pulse
// "Conectar al LIVE" desde la UI (hoy solo arranca en el boot vía env).

// ---------------------------------------------------------------------------
// Conexión real a TikTok LIVE. Por ahora arranca en el boot leyendo el
// username de TIKTOK_USERNAME (sin UI, eso es otro issue). Los eventos
// normalizados alimentan a `engine.handleEvent` exactamente igual que los
// que llegan por el canal "live-event" del Simulador. Si el LIVE no está
// disponible no se cae el proceso: se loguea y se sigue.
// ---------------------------------------------------------------------------
const tiktokUsername = process.env.TIKTOK_USERNAME?.trim();
if (tiktokUsername) {
  const tiktok = new TikTokLiveSource(tiktokUsername);
  tiktok.on("log", (entry) => {
    const tag = `[tiktok:${entry.level}]`;
    // eslint-disable-next-line no-console
    console.log(tag, entry.message, entry.details ?? "");
  });
  tiktok.on("event", (evt) => {
    engine.handleEvent(evt).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Error procesando live-event (TikTok):", err);
    });
  });
  tiktok.on("connected", () => engine.resetSession());
  tiktok.start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`No se pudo conectar al LIVE de TikTok (@${tiktokUsername}):`, err?.message ?? err);
  });
} else {
  // eslint-disable-next-line no-console
  console.log("TIKTOK_USERNAME no configurado: no se conecta a TikTok LIVE (solo Simulador).");
}

export { modBridge, server, engine };
