import { join } from "node:path";
import { ALERT_PRESETS, DUEL_PRESETS, GOAL_PRESETS, TOP_PRESETS, type EventLogEntry, type Goal, type LiveEvent } from "@streamtok/shared";
import { AccionesEventosEngine } from "./acciones-eventos-engine.js";
import { EventRecorder, maxBytesFromEnv } from "./event-recorder.js";
import {
  GiftCatalogController,
  GiftCatalogStore,
  defaultGiftCatalogFilePath,
} from "./gift-catalog.js";
import { appDataDir } from "./mapping-rules.js";
import { ModBridge } from "./mod-bridge.js";
import {
  OverlayCounters,
  OverlaysStore,
  defaultOverlaysFilePath,
} from "./overlay-counters.js";
import { RoomController, RoomStateEngine } from "./room-state.js";
import { GoalsController } from "./goals-controller.js";
import { AlertasEngine, AlertasStore, defaultAlertasFilePath } from "./alertas.js";
import { AlertasController } from "./alertas-controller.js";
import { DuelosEngine, DuelosStore, defaultDuelosFilePath } from "./duelos.js";
import { DuelosController } from "./duelos-controller.js";
import { AgenteEngine, AgenteStore, defaultAgenteFilePath } from "./agente.js";
import { AgenteController } from "./agente-controller.js";
import { KeysStore, defaultKeysFilePath } from "./agente-keys.js";
import { ModelService } from "./agente-model.js";
import { LiveMoodEngine } from "./agente-animo.js";
import { VoiceService } from "./agente-voz.js";
import { TriviaEngine } from "./agente-trivia.js";
import { TopsEngine, TopsStore, defaultTopsFilePath } from "./tops.js";
import { TopsController } from "./tops-controller.js";
import { GoalsEngine, GoalsStore, defaultGoalsFilePath } from "./goals.js";
import { OverlayHttpServer, overlayPortFromEnv } from "./overlay-server.js";
import { OverlaysController } from "./overlays-controller.js";
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
// Decisiones del motor en la consola: qué regalo/evento llegó y qué disparó (o
// por qué no coincidió ningún Evento). Se omiten los likes parciales, los
// mensajes de combo en curso y los eventos que no son regalos sin coincidencia.
engine.on("event-log", (e: EventLogEntry) => {
  if (e.reason === "like-threshold" || e.reason === "gift-in-progress") return;
  if (e.reason === "no-match" && e.event !== "gift") return;
  // eslint-disable-next-line no-console
  console.log(`[engine:${e.status === "fired" ? "info" : "warn"}]`, e.message, e.eventoId ? `(evento ${e.eventoId})` : "");
});

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
// Overlays y contadores (ADR 0011): timer y wins. El motor de contadores es la
// única fuente de verdad; el canal WS "overlays" lo reparte a la UI y a las
// páginas que sirve el servidor HTTP local (para LIVE Studio / OBS). Los
// comandos internos `app.*` de las Acciones y los "segundos por tipo" del timer
// lo alimentan desde los mismos LiveEvents que ve el motor de Acciones.
// ---------------------------------------------------------------------------
const overlayCounters = new OverlayCounters({
  store: new OverlaysStore(defaultOverlaysFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[overlays:warn]", message),
  ),
});
overlayCounters.on("log", (entry) => {
  const tag = `[overlays:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});
// Al llegar el timer a 0 se ejecutan las Acciones elegidas en "al expirar".
overlayCounters.on("timer-expired", (accionIds: string[]) => {
  // eslint-disable-next-line no-console
  console.log("[overlays:info] el timer llegó a 0");
  engine.runAcciones(accionIds, "timer-expired").catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Error ejecutando las acciones de fin del timer:", err);
  });
});
new OverlaysController(server, overlayCounters);

// Metas (ADR 0012): varias metas a la vez, cada una con su overlay /overlay/meta/<id>.
const goals = new GoalsEngine({
  presets: GOAL_PRESETS,
  store: new GoalsStore(defaultGoalsFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[goals:warn]", message),
  ),
});
goals.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[goals:${entry.level}]`, entry.message, entry.details ?? "");
});
// Al cumplirse una meta se ejecutan las Acciones elegidas en "Acciones al finalizar".
goals.on("goal-reached", (goal: Goal) => {
  if (goal.config.onReachAccionIds.length === 0) return;
  engine.runAcciones(goal.config.onReachAccionIds, `meta:${goal.config.id}`).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Error ejecutando las acciones de fin de meta:", err);
  });
});
new GoalsController(server, goals);

// Alertas de comunidad y nivel (ADR 0014): avisos "se unió" y "subió de nivel" para /overlay/nivel/<id>.
const alertas = new AlertasEngine({
  presets: ALERT_PRESETS,
  store: new AlertasStore(defaultAlertasFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[alertas:warn]", message),
  ),
});
alertas.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[alertas:${entry.level}]`, entry.message);
});
new AlertasController(server, alertas);

// Duelos (ADR 0015): Regalo vs Regalo, Azul vs Rojo y Top 1 vs Top 2 para /overlay/duelo/<id>.
const duelos = new DuelosEngine({
  presets: DUEL_PRESETS,
  store: new DuelosStore(defaultDuelosFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[duelos:warn]", message),
  ),
});
duelos.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[duelos:${entry.level}]`, entry.message);
});
new DuelosController(server, duelos);

// Tops (ADR 0017): Top Gifters, Likes, Comentarios y Compartidos para /overlay/top/<id>.
const tops = new TopsEngine({
  presets: TOP_PRESETS,
  store: new TopsStore(defaultTopsFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[tops:warn]", message),
  ),
});
tops.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[tops:${entry.level}]`, entry.message);
});
new TopsController(server, tops);

// Agente IA (ADR 0016): cola de preguntas con prioridad para /overlay/agente. Las respuestas las da el modelo que elijas (DeepSeek, OpenAI, Gemini o Claude) con tu clave.
const agenteModel = new ModelService({
  keys: new KeysStore(defaultKeysFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[agente:warn]", message),
  ),
  liveContext: () => agenteAnimo.contextLine(),
});
// Ánimo del LIVE: mide cuánto movimiento hay (monedas, comentarios, likes...) y decide el tono de voz y de texto del agente.
const agenteAnimo: LiveMoodEngine = new LiveMoodEngine({ getConfig: () => agente.getConfig().animo });
const agente: AgenteEngine = new AgenteEngine({
  store: new AgenteStore(defaultAgenteFilePath(), (message) =>
    // eslint-disable-next-line no-console
    console.warn("[agente:warn]", message),
  ),
  responder: agenteModel.respond,
  canShowTip: () => agenteTrivia.getState().phase === "idle",
  // durante la trivia (preparándose, abierta o enseñando la respuesta) el agente no atiende la cola
  paused: () => agenteTrivia.getState().phase !== "idle",
});
agenteModel.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[agente:${entry.level}]`, entry.message);
});
agente.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[agente:${entry.level}]`, entry.message);
});
// Trivia del agente: sale sola cuando el chat está tranquilo; quien acierta gana prioridad y suma al Top Trivia.
const agenteTrivia: TriviaEngine = new TriviaEngine({
  generator: (config, recent) => agenteModel.generateTrivia(config, recent),
  getConfig: () => agente.getConfig(),
  busy: () => agente.isBusy(),
  onWinner: (w) => {
    agente.grantPrize(w.handle, agente.getConfig().trivia.prizeCoins);
    tops.credit("trivia", w.handle, w.name, w.avatarUrl, 1);
  },
});
agenteTrivia.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[agente:${entry.level}]`, entry.message);
});
// Voz humana en la nube (Gemini TTS) con la misma clave de Gemini del modelo; si falla o no hay clave, el overlay usa la voz del equipo.
const agenteVoz = new VoiceService({ getKey: () => agenteModel.keyFor("gemini") });
agenteVoz.on("log", (entry) => {
  // eslint-disable-next-line no-console
  console.log(`[agente:${entry.level}]`, entry.message);
});
new AgenteController(server, agente, agenteModel, agenteTrivia, agenteVoz, agenteAnimo);

// Estado de la sala (ADR 0013): espectadores y marcador de batalla. Alimenta las metas de espectadores.
const room = new RoomStateEngine();
new RoomController(server, room);
room.on("viewers", (count: number) => goals.handleViewers(count));

// Los comandos internos `app.*` de las Acciones: `app.goal.*` van a las metas, el resto a Timer/Wins.
const appCommands = {
  applyAppCommand: (id: string, params: Record<string, unknown>) =>
    id.startsWith("app.goal.") ? goals.applyAppCommand(id, params) : overlayCounters.applyAppCommand(id, params),
};
engine.setCounters(appCommands);

const overlayHttp = new OverlayHttpServer({ port: overlayPortFromEnv(process.env), wsPort: PORT });
overlayHttp
  .listen()
  .then((port) => {
    // eslint-disable-next-line no-console
    console.log(`[overlays:info] overlays en http://localhost:${port}/overlay/timer, /overlay/wins, /overlay/meta/<id>, /overlay/nivel/<id>, /overlay/duelo/<id>, /overlay/top/<id>, /overlay/agente (o /overlay/agente/cola y /overlay/agente/respuesta por separado) y /overlay/prueba-audio`);
  })
  .catch((err) => {
    // No tumba el sidecar: sin el servidor de overlays todo lo demás sigue funcionando.
    // eslint-disable-next-line no-console
    console.error(`[overlays:error] no se pudo abrir el servidor de overlays: ${(err as Error).message}`);
  });

// ---------------------------------------------------------------------------
// Canal "manual-command" (UI → sidecar): dispara un mod-command puntual (botón
// "Probar acción" de la UI) reusando ModBridge.sendCommand. No toca el
// protocolo del mod.
// ---------------------------------------------------------------------------
registerManualCommand(server, modBridge, appCommands);

// ---------------------------------------------------------------------------
// Fuente de LiveEvents. En producción esto viene de tiktok-live-connector
// (ver README del sidecar); por ahora solo se re-emite lo que llegue por el
// canal "live-event" (útil para el Simulador de la UI: manda eventos falsos
// por WS y el sidecar los procesa exactamente igual que si fueran reales).
// ---------------------------------------------------------------------------
server.onChannel("live-event", (payload) => {
  const evt = payload as LiveEvent;
  overlayCounters.handleLiveEvent(evt);
  goals.handleLiveEvent(evt);
  alertas.handleLiveEvent(evt);
  duelos.handleLiveEvent(evt);
  tops.handleLiveEvent(evt);
  agente.handleLiveEvent(evt);
  agenteAnimo.handleLiveEvent(evt);
  agenteTrivia.handleLiveEvent(evt);
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
    overlayCounters.handleLiveEvent(evt);
    goals.handleLiveEvent(evt);
    alertas.handleLiveEvent(evt);
    duelos.handleLiveEvent(evt);
    tops.handleLiveEvent(evt);
    agente.handleLiveEvent(evt);
    agenteAnimo.handleLiveEvent(evt);
    agenteTrivia.handleLiveEvent(evt);
    engine.handleEvent(evt).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Error procesando live-event (TikTok):", err);
    });
  },
  onGift: (entry) => giftCatalogController.learn(entry),
  onRoom: (kind, raw) => {
    if (kind === "roomUser") room.ingestRoomUser(raw);
    else if (kind === "battleArmies") room.ingestBattleArmies(raw);
    else room.ingestBattleHosts(raw);
  },
  onConnected: () => {
    engine.resetSession();
    overlayCounters.resetSession();
    goals.resetSession();
    alertas.resetSession();
    duelos.resetSession();
    tops.resetSession();
    agente.resetSession();
    agenteModel.resetSession();
    agenteVoz.resetSession();
    agenteAnimo.reset();
    agenteTrivia.resetSession();
    room.reset();
  },
});
tiktokConnection.on("log", (entry) => {
  const tag = `[tiktok:${entry.level}]`;
  // eslint-disable-next-line no-console
  console.log(tag, entry.message, entry.details ?? "");
});

// Cierra la grabación completa al terminar el proceso (Ctrl+C / cierre de la app).
const shutdown = () => {
  overlayCounters.dispose();
  void overlayHttp.close();
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
