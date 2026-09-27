import type { LiveEvent } from "@streamtok/shared";
import { MappingEngine } from "./mapping.js";
import {
  MappingRulesController,
  MappingRulesStore,
  defaultRulesFilePath,
} from "./mapping-rules.js";
import { ModBridge } from "./mod-bridge.js";
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
// Reglas de mapeo evento→acción. Se cargan/persisten desde un JSON en app-data
// (ver ADR 0001 y mapping-rules.ts). La UI las edita por el canal WS
// "mapping-rules"; acá solo se arma el motor y el controlador que lo alimenta.
// ---------------------------------------------------------------------------
const mapping = new MappingEngine(modBridge);

const rulesStore = new MappingRulesStore(defaultRulesFilePath());
const rulesController = new MappingRulesController(
  server,
  rulesStore,
  mapping,
  () => modBridge.getCatalog(),
);
rulesController.on("log", (entry) => {
  const tag = `[rules:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});

// ---------------------------------------------------------------------------
// Fuente de LiveEvents. En producción esto viene de tiktok-live-connector
// (ver README del sidecar); por ahora solo se re-emite lo que llegue por el
// canal "live-event" (útil para el Simulador de la UI: manda eventos falsos
// por WS y el sidecar los procesa exactamente igual que si fueran reales).
// ---------------------------------------------------------------------------
server.onChannel("live-event", (payload) => {
  const evt = payload as LiveEvent;
  mapping.handleEvent(evt).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Error procesando live-event:", err);
  });
});

// TODO(ui): arrancar/parar esta conexión cuando el usuario pulse
// "Conectar al LIVE" desde la UI (hoy solo arranca en el boot vía env).

// ---------------------------------------------------------------------------
// Conexión real a TikTok LIVE. Por ahora arranca en el boot leyendo el
// username de TIKTOK_USERNAME (sin UI, eso es otro issue). Los eventos
// normalizados alimentan a `mapping.handleEvent` exactamente igual que los
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
    mapping.handleEvent(evt).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Error procesando live-event (TikTok):", err);
    });
  });
  tiktok.start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`No se pudo conectar al LIVE de TikTok (@${tiktokUsername}):`, err?.message ?? err);
  });
} else {
  // eslint-disable-next-line no-console
  console.log("TIKTOK_USERNAME no configurado: no se conecta a TikTok LIVE (solo Simulador).");
}

export { modBridge, server, mapping };
