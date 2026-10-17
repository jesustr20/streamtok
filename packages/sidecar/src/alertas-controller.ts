import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { AlertConfigSchema, AlertasMessageSchema, type AlertEvent } from "@streamtok/shared";
import type { AlertasEngine } from "./alertas.js";
import { formatZodError } from "./mapping-rules.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Canal WS `alertas` (ADR 0014): reparte la configuración y los avisos a la UI y a las páginas
 * de overlay, y recibe la gestión desde la UI. Los overlays solo LEEN, por convención (el
 * servidor WS no autentica; ver ADR 0011).
 */
export class AlertasController extends EventEmitter {
  constructor(
    private server: StreamTokWsServer,
    private alertas: AlertasEngine,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("alertas", (payload, socket) => this.handle(payload, socket));
    this.alertas.on("state", () => this.server.broadcast("alertas", this.statePayload()));
    this.alertas.on("alert", (alert: AlertEvent) => this.server.broadcast("alertas", { kind: "alert", alert }));
  }

  private statePayload() {
    return {
      kind: "state" as const,
      configs: this.alertas.getConfigs(),
      joinGiftNames: this.alertas.getJoinGiftNames(),
      serverNow: Date.now(),
    };
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "alertas", this.statePayload());
  }

  private error(socket: WebSocket, message: string) {
    this.server.sendTo(socket, "alertas", { kind: "error", message });
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = AlertasMessageSchema.safeParse(payload);
    if (!parsed.success) {
      if ((payload as { kind?: unknown } | null)?.kind === "save") {
        const cfg = AlertConfigSchema.safeParse((payload as { config?: unknown }).config);
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
        this.alertas.save(msg.config);
        return;
      case "set-join-gifts":
        this.alertas.setJoinGiftNames(msg.names);
        return;
      case "test":
        this.alertas.test(msg.alertKind);
        return;
      default:
        return; // `state`, `alert` y `error` los emite el sidecar
    }
  }
}
