import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { AgentConfigSchema, AgentMessageSchema, type AgentProviderId } from "@streamtok/shared";
import type { AgenteEngine } from "./agente.js";
import type { ModelService } from "./agente-model.js";
import type { VoiceService } from "./agente-voz.js";
import type { TriviaEngine } from "./agente-trivia.js";
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
  /** copias del overlay que leen en voz alta (para diagnosticar voces dobles) */
  private voiceOverlays = new Set<WebSocket>();

  constructor(
    private server: StreamTokWsServer,
    private agente: AgenteEngine,
    private model?: ModelService,
    private trivia?: TriviaEngine,
    private voice?: VoiceService,
  ) {
    super();
    this.server.on("client-connected", (socket) => this.sendStateTo(socket));
    this.server.on("client-disconnected", (socket) => {
      if (this.voiceOverlays.delete(socket)) this.scheduleBroadcast();
    });
    this.server.onChannel("agente", (payload, socket) => this.handle(payload, socket));
    this.agente.on("state", () => this.scheduleBroadcast());
    this.model?.on("state", () => this.scheduleBroadcast());
    this.trivia?.on("state", () => this.scheduleBroadcast());
    this.voice?.on("state", () => this.scheduleBroadcast());
    this.ticker = setInterval(() => {
      this.agente.tick();
      this.trivia?.tick();
    }, TICK_EVERY_MS);
    this.ticker.unref?.();
  }

  private statePayload() {
    return {
      kind: "state" as const,
      config: this.agente.getConfig(),
      state: this.agente.getState(),
      // solo si hay clave o no: la clave misma nunca sale del sidecar
      keys: this.model?.keyStatus() ?? { deepseek: false, openai: false, gemini: false, claude: false },
      modelCalls: this.model?.modelCalls ?? 0,
      trivia: this.trivia?.getState() ?? { phase: "idle" as const, options: [], deadline: 0, answers: 0, startedAt: 0 },
      serverNow: Date.now(),
      voiceOverlays: this.voiceOverlays.size,
      ttsCalls: this.voice?.ttsCalls ?? 0,
    };
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

  private async testConnection(provider: AgentProviderId, socket: WebSocket) {
    const r = this.model
      ? await this.model.testConnection(provider, this.agente.getConfig())
      : { ok: false, message: "El modelo no está disponible.", ms: 0 };
    this.server.sendTo(socket, "agente", { kind: "test-result", provider, ...r });
  }

  private async listModels(provider: AgentProviderId, socket: WebSocket) {
    const r = this.model ? await this.model.listModels(provider) : { ok: false, models: [], message: "El modelo no está disponible." };
    this.server.sendTo(socket, "agente", { kind: "models", provider, ...r });
  }

  /** Audio de una frase con la voz de la nube; solo se responde a quien lo pidió. */
  private async tts(msg: { id: string; text: string; mood: "calm" | "happy" | "excited" | "mystery"; voice?: string; style?: string; model?: string }, socket: WebSocket) {
    const cfg = this.agente.getConfig().voice;
    const r = this.voice
      ? await this.voice.synthesize(
          { text: msg.text, mood: msg.mood, voice: msg.voice ?? cfg.geminiVoice, style: msg.style ?? cfg.style, model: msg.model ?? cfg.geminiModel },
          cfg.maxCloudCalls,
        )
      : ({ ok: false, message: "La voz de la nube no está disponible." } as const);
    this.server.sendTo(
      socket,
      "agente",
      r.ok
        ? { kind: "tts-audio", id: msg.id, ok: true, message: "", mime: "audio/wav", data: r.wav.toString("base64") }
        : { kind: "tts-audio", id: msg.id, ok: false, message: r.message, mime: "", data: "" },
    );
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
      case "trivia-start":
        if (!this.trivia?.start(msg.sample)) this.server.sendTo(socket, "agente", { kind: "error", message: "Ya hay una trivia en curso." });
        return;
      case "tip-now":
        if (!this.agente.showTip()) this.server.sendTo(socket, "agente", { kind: "error", message: "No hay avisos que mostrar: marca algún requisito o añade un aviso tuyo." });
        return;
      case "trivia-cancel":
        this.trivia?.cancel();
        return;
      case "set-key":
        this.model?.setKey(msg.provider, msg.key);
        return;
      case "remove-key":
        this.model?.removeKey(msg.provider);
        return;
      case "test-connection":
        void this.testConnection(msg.provider, socket);
        return;
      case "overlay-hello":
        if (msg.speaks) {
          this.voiceOverlays.add(socket);
          this.emit("log", { level: "info", message: `Overlay del agente con voz conectado (ahora ${this.voiceOverlays.size}).` });
          this.scheduleBroadcast();
        }
        return;
      case "list-models":
        void this.listModels(msg.provider, socket);
        return;
      case "tts":
        void this.tts(msg, socket);
        return;
      default:
        return;
    }
  }
}
