import type { AgentConfig, AgentKeyStatus, AgentTriviaState, AgentMessage, AgentProviderId, AgentState, TtsMood } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { config: AgentConfig; state: AgentState; keys: AgentKeyStatus; modelCalls: number; trivia: AgentTriviaState; serverNow: number; voiceOverlays: number; ttsCalls: number };
/** Audio de una frase con la voz de la nube (WAV en base64) o el motivo del fallo. */
export type TtsReply = { ok: boolean; message: string; mime: string; data: string };
export type TestResult = { ok: boolean; message: string; ms: number };
/** Modelos que da el proveedor: cargando, lista, o el motivo del fallo. */
export type ModelList = { status: "loading" } | { status: "ok"; models: string[]; message: string } | { status: "error"; message: string };
type Models = Partial<Record<AgentProviderId, ModelList>>;
// Último estado recibido: al volver a la vista aparece al instante.
let last: Cached | null = null;
let lastModels: Models = {};
// Respuestas `tts-audio` que esperan los botones de "Probar voces"
const ttsWaiters = new Map<string, (r: TtsReply) => void>();
let ttsSeq = 0;

/** Agente IA (canal WS `agente`, ADR 0016). */
export function useAgente(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<AgentProviderId, TestResult | "pending">>>({});
  const [models, setModelsState] = useState<Models>(lastModels);
  const setModels = useCallback((fn: (m: Models) => Models) => {
    setModelsState((m) => (lastModels = fn(m)));
  }, []);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "agente") return;
      const msg = evt.payload as AgentMessage;
      if (msg.kind === "state") {
        last = { config: msg.config, state: msg.state, keys: { deepseek: false, openai: false, gemini: false, claude: false, ...msg.keys }, modelCalls: msg.modelCalls, trivia: msg.trivia, serverNow: msg.serverNow, voiceOverlays: msg.voiceOverlays ?? 0, ttsCalls: msg.ttsCalls ?? 0 };
        setData(last);
        setError(null);
      } else if (msg.kind === "test-result") {
        setTests((t) => ({ ...t, [msg.provider]: { ok: msg.ok, message: msg.message, ms: msg.ms } }));
      } else if (msg.kind === "models") {
        setModels((m) => ({ ...m, [msg.provider]: msg.ok ? { status: "ok", models: msg.models, message: msg.message } : { status: "error", message: msg.message } }));
      } else if (msg.kind === "tts-audio") {
        const done = ttsWaiters.get(msg.id);
        if (done) {
          ttsWaiters.delete(msg.id);
          done({ ok: msg.ok, message: msg.message, mime: msg.mime, data: msg.data });
        }
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("agente", { kind: "get-state" });
    return off;
  }, [client, setModels]);

  const save = useCallback((config: AgentConfig) => client?.send("agente", { kind: "save", config }), [client]);
  const reset = useCallback(() => client?.send("agente", { kind: "reset" }), [client]);
  const ask = useCallback(
    (name: string, question: string, coins = 0) => client?.send("agente", { kind: "ask", name, question, coins }),
    [client],
  );

  const startTrivia = useCallback((sample: boolean) => client?.send("agente", { kind: "trivia-start", sample }), [client]);
  const showTip = useCallback(() => client?.send("agente", { kind: "tip-now" }), [client]);
  const cancelTrivia = useCallback(() => client?.send("agente", { kind: "trivia-cancel" }), [client]);
  const setKey = useCallback(
    (provider: AgentProviderId, key: string) => {
      setTests((t) => ({ ...t, [provider]: undefined }));
      setModels((m) => ({ ...m, [provider]: undefined }));
      client?.send("agente", { kind: "set-key", provider, key });
    },
    [client],
  );
  const removeKey = useCallback(
    (provider: AgentProviderId) => {
      setTests((t) => ({ ...t, [provider]: undefined }));
      setModels((m) => ({ ...m, [provider]: undefined }));
      client?.send("agente", { kind: "remove-key", provider });
    },
    [client],
  );
  const testConnection = useCallback(
    (provider: AgentProviderId) => {
      setTests((t) => ({ ...t, [provider]: "pending" }));
      client?.send("agente", { kind: "test-connection", provider });
    },
    [client],
  );

  /** Pide a la API del proveedor su lista de modelos (no gasta saldo). */
  const listModels = useCallback(
    (provider: AgentProviderId) => {
      setModels((m) => ({ ...m, [provider]: { status: "loading" } }));
      client?.send("agente", { kind: "list-models", provider });
    },
    [client, setModels],
  );

  /** Pide el audio de una frase a la voz de la nube (gasta un audio del tope del LIVE; las frases repetidas salen de la memoria). */
  const tts = useCallback(
    (text: string, opts: { mood?: TtsMood; voice?: string; style?: string; model?: string } = {}) =>
      new Promise<TtsReply>((resolve) => {
        if (!client) return resolve({ ok: false, message: "Sin conexión con el sidecar.", mime: "", data: "" });
        const id = `ui${++ttsSeq}`;
        const timer = setTimeout(() => {
          ttsWaiters.delete(id);
          resolve({ ok: false, message: "Gemini tardó demasiado en responder.", mime: "", data: "" });
        }, 35_000);
        ttsWaiters.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        client.send("agente", { kind: "tts", id, text, mood: opts.mood ?? "calm", voice: opts.voice, style: opts.style, model: opts.model });
      }),
    [client],
  );

  return {
    config: data?.config ?? null,
    state: data?.state ?? null,
    keys: data?.keys ?? null,
    modelCalls: data?.modelCalls ?? 0,
    trivia: data?.trivia ?? null,
    serverNow: data?.serverNow ?? 0,
    voiceOverlays: data?.voiceOverlays ?? 0,
    ttsCalls: data?.ttsCalls ?? 0,
    tts,
    tests,
    models,
    listModels,
    error,
    save,
    reset,
    ask,
    setKey,
    removeKey,
    testConnection,
    startTrivia,
    cancelTrivia,
    showTip,
  };
}
