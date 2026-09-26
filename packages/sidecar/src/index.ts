import type { LiveEvent } from "@streamtok/shared";
import { MappingEngine, type MappingRule } from "./mapping.js";
import { ModBridge } from "./mod-bridge.js";
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
// Reglas de mapeo evento→acción. TODO: cargar/guardar desde la config que
// arma la UI (Acciones y Eventos); acá van unas de ejemplo para poder probar
// el flujo end-to-end con el simulador antes de tener la UI conectada.
// ---------------------------------------------------------------------------
const initialRules: MappingRule[] = [
  {
    id: "rule-arena-join-rose",
    when: { event: "gift", giftId: 5655 }, // Rose
    action: "arena_join",
    params: { character: "default" },
    passCoinsAsParam: "coins",
  },
  {
    id: "rule-vehicle-comment",
    when: { event: "comment", command: "!carro" },
    action: "vehicle_spawn_random",
    params: { amount: 1 },
  },
];

const mapping = new MappingEngine(modBridge, initialRules);

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

// TODO(tiktok-live-connector): conectar acá con WebcastPushConnection cuando
// el usuario pulse "Conectar al LIVE" desde la UI. Normalizar sus eventos a
// LiveEvent (ver packages/shared/src/live-event.ts) y llamar
// mapping.handleEvent(evt) — mismo camino que ya usa el Simulador.

export { modBridge, server, mapping };
