import type {
  ManualCommandRequest,
  ManualCommandResponse,
  MappingRulesMessage,
  ModAckPayload,
  ModHelloPayload,
  ProfilesMessage,
} from "@streamtok/shared";

export type SidecarEvent =
  | { channel: "mod-hello"; payload: ModHelloPayload }
  | { channel: "mod-ack"; payload: ModAckPayload }
  | { channel: "mapping-rules"; payload: MappingRulesMessage }
  | { channel: "manual-command"; payload: ManualCommandResponse }
  | { channel: "profiles"; payload: ProfilesMessage }
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

  /** Envía un `manual-command` y resuelve con la respuesta (ack o error) del
   * sidecar. Asume una sola request en vuelo (lo que ActionsPanel garantiza:
   * solo hay una acción expandida y el botón se deshabilita mientras espera). */
  sendManualCommand(request: ManualCommandRequest, timeoutMs = 10000): Promise<ManualCommandResponse> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Sidecar no conectado."));
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;

      const off = this.on((evt) => {
        if (evt.channel !== "manual-command") return;
        off();
        if (timer) clearTimeout(timer);
        resolve(evt.payload as ManualCommandResponse);
      });

      timer = setTimeout(() => {
        off();
        reject(new Error("Sin respuesta del sidecar (timeout)."));
      }, timeoutMs);

      this.ws.send(JSON.stringify({ channel: "manual-command", payload: request }));
    });
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
