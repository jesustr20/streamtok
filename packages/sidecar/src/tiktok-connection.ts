import { EventEmitter } from "node:events";
import {
  TiktokConnectionMessageSchema,
  type GiftCatalogEntry,
  type LiveEvent,
  type TiktokConnectionState,
} from "@streamtok/shared";
import type { WebSocket } from "ws";
import type { StreamTokWsServer } from "./ws-server.js";

/** Lo que el controlador necesita de `TikTokLiveSource` (inyectable en tests). */
export interface LiveSource extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Lo que el controlador necesita de `EventRecorder`. */
export interface RawRecorder {
  readonly filePath: string;
  record(type: string, event: unknown): void;
  close(): Promise<void>;
}

export interface TiktokConnectionDeps {
  createRecorder(username: string): RawRecorder;
  createSource(username: string, recorder: Pick<RawRecorder, "record">): LiveSource;
  onEvent(evt: LiveEvent): void;
  onGift(entry: GiftCatalogEntry): void;
  /** Se llama cuando una conexión queda establecida (ej. reiniciar la sesión del motor). */
  onConnected(): void;
}

const STATE_REFRESH_MS = 1000;

/**
 * Arranca/para la conexión al LIVE de TikTok a pedido de la UI (canal WS
 * `tiktok-connection`). Cada conexión graba SIEMPRE todos los mensajes crudos
 * en un archivo propio (event-recorder.ts), aparte del catálogo de regalos.
 */
export class TiktokConnectionController extends EventEmitter {
  private state: TiktokConnectionState = { status: "idle", recordedEvents: 0 };
  private source: LiveSource | null = null;
  private recorder: RawRecorder | null = null;
  /** Identifica la conexión vigente: eventos de conexiones viejas se ignoran. */
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastBroadcastCount = 0;

  constructor(
    private readonly server: StreamTokWsServer,
    private readonly deps: TiktokConnectionDeps,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("tiktok-connection", (payload, socket) => {
      const parsed = TiktokConnectionMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.kind === "get-state") this.sendStateTo(socket);
      else if (msg.kind === "connect") void this.connect(msg.username);
      else if (msg.kind === "disconnect") void this.disconnect();
    });
  }

  getState(): TiktokConnectionState {
    return this.state;
  }

  async connect(rawUsername: string): Promise<void> {
    const username = rawUsername.trim().replace(/^@+/, "").trim();
    await this.teardown();
    const generation = ++this.generation;

    if (!username) {
      this.setState({ status: "error", recordedEvents: 0, error: "Escribe el usuario de TikTok que está en vivo." });
      return;
    }

    const recorder = this.deps.createRecorder(username);
    let count = 0;
    const counting: Pick<RawRecorder, "record"> = {
      record: (type, event) => {
        recorder.record(type, event);
        count++;
        if (generation === this.generation) this.state = { ...this.state, recordedEvents: count };
      },
    };
    const source = this.deps.createSource(username, counting);
    this.recorder = recorder;
    this.source = source;
    const current = () => generation === this.generation;

    source.on("log", (entry) => this.emit("log", entry));
    source.on("event", (evt: LiveEvent) => current() && this.deps.onEvent(evt));
    source.on("giftCatalogEntry", (entry: GiftCatalogEntry) => current() && this.deps.onGift(entry));
    source.on("disconnected", () => {
      if (!current()) return;
      // Estado primero (síncrono) y después se libera la grabación.
      this.setState({
        status: "error",
        username,
        recordedEvents: count,
        error: "Se cortó la conexión con el LIVE (terminó el live o se perdió la red).",
      });
      void this.teardown();
    });

    this.setState({ status: "connecting", username, recordingPath: recorder.filePath, recordedEvents: 0 });
    try {
      await source.start();
    } catch (err) {
      if (!current()) return;
      await this.teardown();
      this.setState({
        status: "error",
        username,
        recordedEvents: 0,
        error: (err as Error)?.message ?? String(err),
      });
      return;
    }
    if (!current()) return;
    this.deps.onConnected();
    this.setState({ status: "connected", username, recordingPath: recorder.filePath, recordedEvents: count });
    this.timer = setInterval(() => {
      if (this.state.recordedEvents !== this.lastBroadcastCount) this.broadcastState();
    }, STATE_REFRESH_MS);
    this.timer.unref?.();
  }

  async disconnect(): Promise<void> {
    this.generation++;
    await this.teardown();
    this.setState({ status: "idle", recordedEvents: 0 });
  }

  /** Detiene fuente, grabación y timer de la conexión vigente (si hay). */
  private async teardown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const { source, recorder } = this;
    this.source = null;
    this.recorder = null;
    // La generación cambia en connect()/disconnect(); aquí solo se libera.
    await source?.stop().catch(() => {});
    await recorder?.close().catch(() => {});
  }

  private setState(next: TiktokConnectionState) {
    this.state = next;
    this.broadcastState();
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "tiktok-connection", { kind: "state", state: this.state });
  }

  private broadcastState() {
    this.lastBroadcastCount = this.state.recordedEvents;
    this.server.broadcast("tiktok-connection", { kind: "state", state: this.state });
  }
}
