import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { AgentConfigSchema, AgentMessageSchema } from "@streamtok/shared";
import type { AgenteEngine } from "./agente.js";
import { formatZodError } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/** Máximo un envío cada tanto. */
const BROADCAST_EVERY_MS = 150;
/** Cada cuánto avanza el agente (saca la respuesta vieja, atiende la siguiente). */
const TICK_EVERY_MS = 1000;

/**
 * Canal WS `agente` (ADR 0016): reparte la configuración y la cola a la UI y al overlay, y recibe la
 * gestión desde la UI. Los overlays solo LEEN, por convención (el servidor WS no autentica; ver ADR 0011).
 */
export class AgenteController extends EventEmitter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private ticker: ReturnType<typeof setInterval>;

  constructor(
    private server: StreamTokWsServer,
    private agente: AgenteEngine,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("agente", (payload, socket) => this.handle(payload, socket));
    this.agente.on("state", () => this.scheduleBroadcast());
    this.ticker = setInterval(() => this.agente.tick(), TICK_EVERY_MS);
    this.ticker.unref?.();
  }

  private statePayload() {
    return { kind: "state" as const, config: this.agente.getConfig(), state: this.agente.getState(), serverNow: Date.now() };
  }

  private scheduleBroadcast() {
    if (this.timer) {
      this.pending = true;
      return;
    }
    this.server.broadcast("agente", this.statePayload());
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
    this.server.sendTo(socket, "agente", this.statePayload());
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = AgentMessageSchema.safeParse(payload);
    if (!parsed.success) {
      if ((payload as { kind?: unknown } | null)?.kind === "save") {
        const cfg = AgentConfigSchema.safeParse((payload as { config?: unknown }).config);
        this.server.sendTo(socket, "agente", { kind: "error", message: cfg.success ? "mensaje save inválido" : formatZodError(cfg.error) });
      }
      return;
    }
    const msg = parsed.data;
    switch (msg.kind) {
      case "get-state":
        this.sendStateTo(socket);
        return;
      case "save":
        this.agente.save(msg.config);
        return;
      case "ask":
        this.agente.ask(msg.name, msg.question, msg.coins);
        return;
      case "reset":
        this.agente.reset();
        return;
      default:
        return;
    }
  }
}
