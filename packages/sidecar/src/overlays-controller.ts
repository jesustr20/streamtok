import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { OverlaysConfigSchema, OverlaysMessageSchema } from "@streamtok/shared";
import { formatZodError } from "./mapping-rules.js";
import type { OverlayCounters } from "./overlay-counters.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Canal WS `overlays` (ADR 0011): reparte el estado de los contadores a la UI y
 * a las páginas de overlay, y recibe el control manual (botones de la UI).
 * Mismo patrón `get-state` que `profiles` y `gift-catalog`.
 *
 * Los overlays solo deberían LEER; el servidor WS es un pub/sub genérico sin
 * autenticación, así que esto se respeta por convención (ver ADR 0011).
 */
export class OverlaysController extends EventEmitter {
  constructor(
    private server: StreamTokWsServer,
    private counters: OverlayCounters,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("overlays", (payload, socket) => this.handle(payload, socket));
    this.counters.on("state", () => this.broadcastState());
  }

  private statePayload() {
    return { kind: "state" as const, state: this.counters.getState(), config: this.counters.getConfig() };
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "overlays", this.statePayload());
  }

  private broadcastState() {
    this.server.broadcast("overlays", this.statePayload());
  }

  private error(socket: WebSocket, message: string) {
    this.server.sendTo(socket, "overlays", { kind: "error", message });
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = OverlaysMessageSchema.safeParse(payload);
    if (!parsed.success) {
      // Solo la configuración merece un error explícito; el resto de basura se ignora.
      if ((payload as { kind?: unknown } | null)?.kind === "set-config") {
        const cfg = OverlaysConfigSchema.safeParse((payload as { config?: unknown }).config);
        this.error(socket, cfg.success ? "mensaje set-config inválido" : formatZodError(cfg.error));
      }
      return;
    }
    const msg = parsed.data;
    switch (msg.kind) {
      case "get-state":
        this.sendStateTo(socket);
        return;
      case "timer-control": {
        const needSeconds = msg.op === "add" || msg.op === "set";
        if (needSeconds && typeof msg.seconds !== "number") {
          this.error(socket, `timer-control ${msg.op} necesita "seconds" numérico`);
          return;
        }
        const seconds = msg.seconds as number;
        if (msg.op === "start") this.counters.timerStart();
        else if (msg.op === "pause") this.counters.timerPause();
        else if (msg.op === "reset") this.counters.timerReset();
        else if (msg.op === "stop") this.counters.timerStop();
        else if (msg.op === "add") this.counters.timerAdd(seconds, { manual: true });
        else this.counters.timerSet(seconds);
        return;
      }
      case "wins-control": {
        const v = msg.value;
        if (msg.op === "reset") {
          this.counters.winsReset();
        } else if (msg.op === "set-title") {
          if (typeof v !== "string") return this.error(socket, 'wins-control set-title necesita "value" de texto');
          this.counters.winsSetTitle(v);
        } else {
          if (typeof v !== "number") return this.error(socket, `wins-control ${msg.op} necesita "value" numérico`);
          if (msg.op === "add") this.counters.winsAdd(v);
          else if (msg.op === "set") this.counters.winsSet(v);
          else this.counters.winsSetGoal(v);
        }
        return;
      }
      case "set-config":
        this.counters.setConfig(msg.config);
        return;
      default:
        return; // `state` y `error` los emite el sidecar, no se aceptan de un cliente
    }
  }
}
