import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { WebSocket } from "ws";
import {
  ModAckPayloadSchema,
  ModCommandPayloadSchema,
  ModHelloPayloadSchema,
  MOD_LIMITS,
  type ModAction,
  type ModAckPayload,
  type ModHelloPayload,
} from "@streamtok/shared";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Implementa, del lado app (servidor), el contrato descrito en
 * `claude/mod-gtav-integracion-app.md` (v0.9.0):
 *
 *   mod-hello   mod → app   (al conectar; catálogo de acciones)
 *   mod-command app → mod   (id, action, params, nameTag?, notify?)
 *   mod-ack     mod → app   (id, ok, error?)
 *
 * El mod es CLIENTE del WS en :7331 y se reconecta solo. Esta clase no
 * asume nada de TikTok — solo habla el protocolo del mod. El mapeo
 * evento→acción vive en mapping.ts y llama a `sendCommand`.
 */

const ACK_TIMEOUT_MS = 5000;

interface PendingCommand {
  resolve: (ack: ModAckPayload) => void;
  timer: NodeJS.Timeout;
}

export interface SendCommandOptions {
  nameTag?: string;
  notify?: string;
}

export class ModBridge extends EventEmitter {
  /** última conexión que mandó mod-hello — v1 asume un solo mod (GTA V) */
  private modSocket: WebSocket | null = null;
  private catalog: ModHelloPayload | null = null;
  private pending = new Map<string, PendingCommand>();
  /** cuenta comandos en vuelo para no exceder MOD_LIMITS.maxQueueLength */
  private inFlight = 0;

  constructor(private server: StreamTokWsServer) {
    super();

    this.server.onChannel("mod-hello", (payload, socket) => {
      const parsed = ModHelloPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        this.emit("log", { level: "error", message: "mod-hello inválido", details: parsed.error.format() });
        return;
      }
      this.modSocket = socket;
      this.catalog = parsed.data;
      this.emit("catalog", parsed.data);
      this.emit("log", {
        level: "info",
        message: `Mod conectado: ${parsed.data.mod} v${parsed.data.version} (${parsed.data.actions.length} acciones)`,
      });

      // Fan-out: cualquier otro cliente ya conectado (la UI del desktop,
      // overlays, etc.) también recibe el mod-hello, en el mismo canal que
      // el mod usa — no inventamos un canal aparte tipo "mod-catalog".
      this.server.broadcast("mod-hello", parsed.data, { exclude: socket });

      socket.once("close", () => {
        if (this.modSocket === socket) {
          this.modSocket = null;
          this.emit("disconnected");
          this.emit("log", { level: "warn", message: "Mod desconectado" });
        }
      });
    });

    this.server.onChannel("mod-ack", (payload) => {
      const parsed = ModAckPayloadSchema.safeParse(payload);
      if (!parsed.success) return;
      const ack = parsed.data;
      this.emit("ack", ack);
      const pending = this.pending.get(ack.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(ack.id);
        this.inFlight = Math.max(0, this.inFlight - 1);
        pending.resolve(ack);
      }
      if (!ack.ok) {
        this.emit("log", { level: "error", message: `Comando ${ack.id} falló: ${ack.error ?? "sin detalle"}` });
      }

      // Fan-out del ack para quien quiera loguearlo (UI), mismo canal.
      this.server.broadcast("mod-ack", ack);
    });

    // La UI (u otro consumidor) puede conectarse DESPUÉS de que el mod ya
    // mandó su mod-hello — sin esto, ese cliente nunca vería el catálogo
    // porque el fan-out de arriba ya pasó. Se cachea y se reenvía.
    this.server.on("client-connected", (socket) => {
      if (this.catalog) this.server.sendTo(socket, "mod-hello", this.catalog);
    });
  }

  isConnected(): boolean {
    return this.modSocket !== null;
  }

  getCatalog(): ModHelloPayload | null {
    return this.catalog;
  }

  getAction(actionId: string): ModAction | undefined {
    return this.catalog?.actions.find((a) => a.id === actionId);
  }

  /**
   * Envía un mod-command. Devuelve el mod-ack (o un ack sintético de error
   * si no hay mod conectado, si expira el timeout, o si la app misma decide
   * no encolar más porque ya se pasó el límite documentado del mod
   * (300 comandos en cola → el mod descarta los más viejos).
   */
  async sendCommand(
    action: string,
    params: Record<string, number | string | boolean>,
    opts: SendCommandOptions = {},
  ): Promise<ModAckPayload> {
    const id = nanoid();

    if (!this.modSocket) {
      return { id, ok: false, error: "Mod no conectado" };
    }
    if (this.inFlight >= MOD_LIMITS.maxQueueLength) {
      this.emit("log", {
        level: "warn",
        message: `Cola local llena (${MOD_LIMITS.maxQueueLength}); no se envía "${action}" para no acumular más de lo que el mod va a descartar`,
      });
      return { id, ok: false, error: "Descartado: demasiados comandos en cola" };
    }

    const payload = ModCommandPayloadSchema.parse({
      id,
      action,
      params,
      nameTag: opts.nameTag,
      notify: opts.notify,
    });

    this.inFlight++;
    const ackPromise = new Promise<ModAckPayload>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.inFlight = Math.max(0, this.inFlight - 1);
        resolve({ id, ok: false, error: "Timeout esperando mod-ack" });
      }, ACK_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
    });

    this.server.sendTo(this.modSocket, "mod-command", payload);
    this.emit("log", { level: "debug", message: `→ mod-command ${action} (${id})`, payload });

    return ackPromise;
  }
}
