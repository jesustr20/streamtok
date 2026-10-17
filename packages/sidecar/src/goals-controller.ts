import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { GoalConfigSchema, GoalsMessageSchema } from "@streamtok/shared";
import type { GoalsEngine } from "./goals.js";
import { formatZodError } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Canal WS `goals` (ADR 0012): reparte las metas a la UI y a las páginas de
 * overlay y recibe la gestión desde la UI. Los overlays solo LEEN, por convención
 * (el servidor WS no autentica; ver ADR 0011).
 */
export class GoalsController extends EventEmitter {
  constructor(
    private server: StreamTokWsServer,
    private goals: GoalsEngine,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("goals", (payload, socket) => this.handle(payload, socket));
    this.goals.on("state", () => this.server.broadcast("goals", this.statePayload()));
  }

  private statePayload() {
    return { kind: "state" as const, goals: this.goals.getGoals(), serverNow: Date.now() };
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "goals", this.statePayload());
  }

  private error(socket: WebSocket, message: string) {
    this.server.sendTo(socket, "goals", { kind: "error", message });
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = GoalsMessageSchema.safeParse(payload);
    if (!parsed.success) {
      if ((payload as { kind?: unknown } | null)?.kind === "save") {
        const cfg = GoalConfigSchema.safeParse((payload as { config?: unknown }).config);
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
        this.goals.save(msg.config);
        return;
      case "remove":
        this.goals.remove(msg.id);
        return;
      case "goal-control":
        if (!this.goals.control(msg.id, msg.op, msg.value)) this.error(socket, `no existe la meta "${msg.id}"`);
        return;
      default:
        return; // `state` y `error` los emite el sidecar
    }
  }
}
