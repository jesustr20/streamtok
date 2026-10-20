import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { TopConfigSchema, TopsMessageSchema } from "@streamtok/shared";
import type { TopsEngine } from "./tops.js";
import { formatZodError } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/** Máximo un envío cada tanto: los likes llegan por cientos y el ranking no necesita más. */
const BROADCAST_EVERY_MS = 150;

/**
 * Canal WS `tops` (ADR 0017): reparte la configuración y el ranking a la UI y a las páginas
 * de overlay, y recibe la gestión desde la UI. Los overlays solo LEEN, por convención (el
 * servidor WS no autentica; ver ADR 0011).
 */
export class TopsController extends EventEmitter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  constructor(
    private server: StreamTokWsServer,
    private tops: TopsEngine,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("tops", (payload, socket) => this.handle(payload, socket));
    this.tops.on("state", () => this.scheduleBroadcast());
    // los rankings "del día" se vacían a medianoche aunque nadie escriba nada
    const dayTimer = setInterval(() => this.tops.checkDay(), 60_000);
    dayTimer.unref?.();
  }

  private statePayload() {
    return {
      kind: "state" as const,
      configs: this.tops.getConfigs(),
      states: this.tops.getStates(),
      serverNow: Date.now(),
    };
  }

  /** Primer cambio: se envía al momento; los siguientes se juntan en un solo envío. */
  private scheduleBroadcast() {
    if (this.timer) {
      this.pending = true;
      return;
    }
    this.server.broadcast("tops", this.statePayload());
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
    this.server.sendTo(socket, "tops", this.statePayload());
  }

  private error(socket: WebSocket, message: string) {
    this.server.sendTo(socket, "tops", { kind: "error", message });
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = TopsMessageSchema.safeParse(payload);
    if (!parsed.success) {
      if ((payload as { kind?: unknown } | null)?.kind === "save") {
        const cfg = TopConfigSchema.safeParse((payload as { config?: unknown }).config);
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
        this.tops.save(msg.config);
        return;
      case "reset":
        this.tops.reset(msg.id);
        return;
      case "test":
        this.tops.test(msg.id, msg.name, msg.amount);
        return;
      default:
        return; // `state` y `error` los emite el sidecar
    }
  }
}
