import type {
  MappingRulesMessage,
  ModAckPayload,
  ModHelloPayload,
} from "@streamtok/shared";

export type SidecarEvent =
  | { channel: "mod-hello"; payload: ModHelloPayload }
  | { channel: "mod-ack"; payload: ModAckPayload }
  | { channel: "mapping-rules"; payload: MappingRulesMessage }
  | { channel: string; payload: unknown };

type Listener = (evt: SidecarEvent) => void;

/**
 * Cliente WS del lado desktop: se conecta al mismo sidecar (:7331) que el
 * mod, pero solo como oyente/emisor de la UI — nunca habla el protocolo del
 * mod directamente. Se reconecta solo, igual que el mod, porque el sidecar
 * puede arrancar antes o después que la ventana.
 */
export class SidecarClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url = "ws://localhost:7331") {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SidecarEvent;
        for (const l of this.listeners) l(msg);
      } catch {
        // ignorar mensajes no-JSON
      }
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(channel: string, payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ channel, payload }));
    }
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
