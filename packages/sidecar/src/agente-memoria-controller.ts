import { AgentMemoryMessageSchema } from "@streamtok/shared";
import type { WebSocket } from "ws";
import type { MemoriaService } from "./agente-memoria.js";
import type { StreamTokWsServer } from "./ws-server.js";

/** Canal `agente-memoria` (ADR 0024): la app edita la ficha del streamer y borra los viewers recordados. */
export class MemoriaController {
  constructor(private server: StreamTokWsServer, private memoria: MemoriaService) {
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.onChannel("agente-memoria", (payload, socket) => this.handle(payload, socket));
    this.memoria.on("state", () => this.server.broadcast("agente-memoria", this.statePayload()));
  }

  private statePayload() {
    return {
      kind: "state" as const,
      streamer: this.memoria.getStreamer(),
      viewerCount: this.memoria.viewerCount(),
      conductas: this.memoria.getConductas(),
      ignored: this.memoria.ignoredViewers(),
    };
  }

  private sendStateTo(socket: WebSocket) {
    this.server.sendTo(socket, "agente-memoria", this.statePayload());
  }

  private handle(payload: unknown, socket: WebSocket) {
    const parsed = AgentMemoryMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.server.sendTo(socket, "agente-memoria", { kind: "error", message: "Mensaje de memoria inválido." });
      return;
    }
    const msg = parsed.data;
    switch (msg.kind) {
      case "get-state":
        this.sendStateTo(socket);
        break;
      case "save-streamer":
        this.memoria.saveStreamer(msg.name, msg.aliases);
        break;
      case "add-fact":
        if (!this.memoria.addFact(msg.text)) {
          this.server.sendTo(socket, "agente-memoria", { kind: "error", message: "Ese dato ya existe o se llegó al máximo (100)." });
        }
        break;
      case "remove-fact":
        this.memoria.removeFact(msg.id);
        break;
      case "clear-viewers":
        this.memoria.clearViewers();
        break;
      case "remove-conducta":
        this.memoria.removeConducta(msg.id);
        break;
      case "forgive-viewer":
        this.memoria.forgive(msg.handle);
        break;
      default:
        break;
    }
  }
}
