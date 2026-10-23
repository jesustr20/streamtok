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
  /** Nombre y foto del dueño del LIVE, si la fuente puede darlos. */
  getHostProfile?(): { nickname?: string; avatarUrl?: string } | null;
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
  /** Mensajes de la sala sin normalizar (espectadores y batalla, ADR 0013). */
  onRoom?(kind: "roomUser" | "battleArmies" | "battleHosts", raw: unknown): void;
  /**
   * Se llama cuando una conexión queda establecida (ej. reiniciar la sesión del motor).
   * `resumed` = es la reconexión automática de un corte reciente del mismo LIVE: la sesión sigue
   * (cola de preguntas, regalos acreditados, Tops, metas...) y no debe empezar de cero.
   */
  onConnected(info?: { resumed: boolean }): void;
}

const STATE_REFRESH_MS = 1000;

/**
 * Espera (ms) antes de cada reintento tras un corte del LIVE: crece y se queda
 * en el último valor (30 s) mientras no se pulse "Desconectar".
 */
export const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

/** Si tras un corte se vuelve a conectar dentro de este plazo, se considera el mismo LIVE (la sesión se conserva). */
export const RESUME_WINDOW_MS = 10 * 60_000;

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
  /** Reintento programado tras un corte (se cancela con connect/disconnect). */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Reintentos seguidos desde el último corte (vuelve a 0 al reconectar). */
  private retryAttempt = 0;
  /** Cuándo se cortó por última vez una conexión que estaba establecida (para saber si una reconexión es el mismo LIVE). */
  private lastDropAt = 0;

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
    this.cancelRetry();
    this.retryAttempt = 0;
    await this.teardown();
    const generation = ++this.generation;

    if (!username) {
      this.setState({ status: "error", recordedEvents: 0, error: "Escribe el usuario de TikTok que está en vivo." });
      return;
    }

    await this.startAttempt(username, generation, false);
  }

  /**
   * Un intento de conexión. `auto` = es un reintento tras un corte: si falla
   * vuelve a programarse solo (el primer intento manual NO reintenta, para que
   * un usuario mal escrito o un LIVE apagado se vea como error de inmediato).
   */
  private async startAttempt(username: string, generation: number, auto: boolean): Promise<void> {
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
    for (const kind of ["roomUser", "battleArmies", "battleHosts"] as const) {
      source.on(kind, (raw: unknown) => current() && this.deps.onRoom?.(kind, raw));
    }
    source.on("giftCatalogEntry", (entry: GiftCatalogEntry) => current() && this.deps.onGift(entry));
    source.on("disconnected", () => {
      if (!current()) return;
      this.lastDropAt = Date.now();
      // Estado primero (síncrono) y después se libera la grabación.
      const retry = this.nextRetry();
      this.setState({
        status: "error",
        username,
        recordedEvents: count,
        error: `Se cortó la conexión con el LIVE (terminó el live o se perdió la red). ${retry.text}`,
      });
      void this.teardown();
      this.armRetry(username, generation, retry);
    });

    this.setState({ status: "connecting", username, recordingPath: recorder.filePath, recordedEvents: 0 });
    try {
      await source.start();
    } catch (err) {
      if (!current()) return;
      await this.teardown();
      if (!current()) return;
      const reason = (err as Error)?.message ?? String(err);
      if (auto) {
        const retry = this.nextRetry();
        this.setState({ status: "error", username, recordedEvents: 0, error: `${reason}. ${retry.text}` });
        this.armRetry(username, generation, retry);
      } else {
        this.setState({ status: "error", username, recordedEvents: 0, error: reason });
      }
      return;
    }
    if (!current()) return;
    this.retryAttempt = 0;
    this.deps.onConnected({ resumed: auto && Date.now() - this.lastDropAt <= RESUME_WINDOW_MS });
    let host: { nickname?: string; avatarUrl?: string } | null = null;
    try {
      host = source.getHostProfile?.() ?? null;
    } catch {
      host = null; // el perfil es decorativo: nunca debe tumbar la conexión
    }
    this.setState({
      status: "connected",
      username,
      ...(host?.nickname ? { nickname: host.nickname } : {}),
      ...(host?.avatarUrl ? { avatarUrl: host.avatarUrl } : {}),
      recordingPath: recorder.filePath,
      recordedEvents: count,
    });
    this.timer = setInterval(() => {
      if (this.state.recordedEvents !== this.lastBroadcastCount) this.broadcastState();
    }, STATE_REFRESH_MS);
    this.timer.unref?.();
  }

  async disconnect(): Promise<void> {
    this.generation++;
    this.cancelRetry();
    this.retryAttempt = 0;
    await this.teardown();
    this.setState({ status: "idle", recordedEvents: 0 });
  }

  /** Calcula el siguiente reintento (aumenta el contador) y el texto para la UI. */
  private nextRetry(): { attempt: number; delayMs: number; text: string } {
    const attempt = ++this.retryAttempt;
    const delayMs = RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)];
    return {
      attempt,
      delayMs,
      text: `Reconectando en ${Math.round(delayMs / 1000)} s (intento ${attempt}). Pulsa Desconectar para cancelar.`,
    };
  }

  /** Programa el reintento; se ignora si mientras tanto hubo connect/disconnect. */
  private armRetry(username: string, generation: number, retry: { attempt: number; delayMs: number }): void {
    if (generation !== this.generation) return;
    this.emit("log", {
      level: "warn",
      message: `Se cortó la conexión con @${username}; reintento ${retry.attempt} en ${Math.round(retry.delayMs / 1000)} s`,
    });
    this.cancelRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation !== this.generation) return;
      const next = ++this.generation;
      void this.startAttempt(username, next, true);
    }, retry.delayMs);
    this.retryTimer.unref?.();
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
