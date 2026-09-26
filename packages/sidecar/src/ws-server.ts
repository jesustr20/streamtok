import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Servidor WS genérico de pub/sub, corazón del "backbone" de StreamTok.
 * No conoce el protocolo del mod ni el de TikTok: solo enruta mensajes
 * `{ channel, payload }` entre quien los publica y quien está escuchando
 * ese canal. Overlays, el mod de GTA V y la propia UI del desktop se
 * conectan todos como clientes normales de este mismo servidor.
 */

export interface RawMessage {
  channel: string;
  payload: unknown;
}

type MessageHandler = (payload: unknown, socket: WebSocket) => void;

export class StreamTokWsServer extends EventEmitter {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private handlers = new Map<string, Set<MessageHandler>>();

  constructor(private port: number) {
    super();
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    this.wss.on("listening", () => this.emit("listening", this.actualPort));
  }

  private handleConnection(socket: WebSocket) {
    this.clients.add(socket);
    this.emit("client-connected", socket);

    socket.on("message", (raw) => {
      let msg: RawMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // mensaje no-JSON, se ignora silenciosamente
      }
      if (!msg || typeof msg.channel !== "string") return;

      const set = this.handlers.get(msg.channel);
      if (set) {
        for (const handler of set) handler(msg.payload, socket);
      }
      this.emit("message", msg, socket);
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      this.emit("client-disconnected", socket);
    });

    socket.on("error", (err) => {
      this.emit("client-error", err, socket);
    });
  }

  /** Suscribirse a un canal específico. */
  on(event: "listening", listener: (port: number) => void): this;
  on(event: "client-connected", listener: (socket: WebSocket) => void): this;
  on(event: "client-disconnected", listener: (socket: WebSocket) => void): this;
  on(event: "client-error", listener: (err: Error, socket: WebSocket) => void): this;
  on(event: "message", listener: (msg: RawMessage, socket: WebSocket) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /** Registra un handler tipado para un canal dado (ej. "mod-hello"). */
  onChannel(channel: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    return () => this.handlers.get(channel)?.delete(handler);
  }

  /** Envía un mensaje a un socket específico. */
  sendTo(socket: WebSocket, channel: string, payload: unknown) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ channel, payload }));
  }

  /** Envía un mensaje a todos los clientes conectados (opcionalmente
   * excluyendo uno, ej. no reenviarle al mod su propio mod-hello). */
  broadcast(channel: string, payload: unknown, opts: { exclude?: WebSocket } = {}) {
    const data = JSON.stringify({ channel, payload });
    for (const client of this.clients) {
      if (client === opts.exclude) continue;
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  close() {
    this.wss.close();
  }

  /** Puerto real en el que quedó escuchando (útil con port:0 en tests). */
  get actualPort(): number {
    const addr = this.wss.address();
    if (typeof addr === "string" || addr === null) return this.port;
    return addr.port;
  }
}
