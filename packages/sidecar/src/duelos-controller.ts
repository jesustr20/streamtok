import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { DuelConfigSchema, DuelosMessageSchema } from "@streamtok/shared";
import type { DuelosEngine } from "./duelos.js";
import { formatZodError } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/** Máximo un envío cada tanto: los likes llegan por cientos y el marcador no necesita más. */
const BROADCAST_EVERY_MS = 150;

/**
 * Canal WS `duelos` (ADR 0015): reparte la configuración y el marcador a la UI y a las páginas
 * de overlay, y recibe la gestión desde la UI. Los overlays solo LEEN, por convención (el
 * servidor WS no autentica; ver ADR 0011).
 */
export class DuelosController extends EventEmitter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(
    private server: StreamTokWsServer,
    private duelos: DuelosEngine,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("duelos", (payload, socket) => this.handle(payload, socket));
    this.duelos.on("state", () => this.scheduleBroadcast());
  }

  private statePayload() {
    return {
      kind: "state" as const,
      configs: this.duelos.getConfigs(),
      states: this.duelos.getStates(),
      serverNow: Date.now(),
    };
  }

  /** Primer cambio: se envía al momento; los siguientes se juntan en un solo envío. */
  private scheduleBroadcast() {
    if (this.timer) {
      this.pending = true;
      return;
    }
    this.server.broadcast("duelos", this.statePayload());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending) {
        this.pending = false;
        this.scheduleBroadcast();
      }
    }, BROADCAST_EVERY_MS);
    this.timer.unref?.();
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "duelos", this.statePayload());
  }

  private error(socket: WebSocket, message: string) {
    this.server.sendTo(socket, "duelos", { kind: "error", message });
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = DuelosMessageSchema.safeParse(payload);
    if (!parsed.success) {
      if ((payload as { kind?: unknown } | null)?.kind === "save") {
        const cfg = DuelConfigSchema.safeParse((payload as { config?: unknown }).config);
        this.error(socket, cfg.success ? "mensaje save inválido" : formatZodError(cfg.error));
      }
      return;
    }
    const msg = parsed.data;
    switch (msg.kind) {
      case "get-state":
        this.sendStateTo(socket);
        return;
      case "save":
        this.duelos.save(msg.config);
        return;
      case "reset":
        this.duelos.reset(msg.id);
        return;
      case "adjust":
        this.duelos.adjust(msg.id, msg.side, msg.delta);
        return;
      case "test":
        this.duelos.test(msg.id, msg.side, msg.units, msg.name, msg.coins);
        return;
      default:
        return; // `state` y `error` los emite el sidecar
    }
  }
}
