import type { AgentConfig, AgentKeyStatus, AgentTriviaState, AgentMessage, AgentProviderId, AgentState } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { config: AgentConfig; state: AgentState; keys: AgentKeyStatus; modelCalls: number; trivia: AgentTriviaState; serverNow: number };
export type TestResult = { ok: boolean; message: string; ms: number };
// Último estado recibido: al volver a la vista aparece al instante.
let last: Cached | null = null;

/** Agente IA (canal WS `agente`, ADR 0016). */
export function useAgente(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<AgentProviderId, TestResult | "pending">>>({});

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "agente") return;
      const msg = evt.payload as AgentMessage;
      if (msg.kind === "state") {
        last = { config: msg.config, state: msg.state, keys: { deepseek: false, openai: false, gemini: false, claude: false, ...msg.keys }, modelCalls: msg.modelCalls, trivia: msg.trivia, serverNow: msg.serverNow };
        setData(last);
        setError(null);
      } else if (msg.kind === "test-result") {
        setTests((t) => ({ ...t, [msg.provider]: { ok: msg.ok, message: msg.message, ms: msg.ms } }));
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("agente", { kind: "get-state" });
    return off;
  }, [client]);

  const save = useCallback((config: AgentConfig) => client?.send("agente", { kind: "save", config }), [client]);
  const reset = useCallback(() => client?.send("agente", { kind: "reset" }), [client]);
  const ask = useCallback(
    (name: string, question: string, coins = 0) => client?.send("agente", { kind: "ask", name, question, coins }),
    [client],
  );

  const startTrivia = useCallback((sample: boolean) => client?.send("agente", { kind: "trivia-start", sample }), [client]);
  const cancelTrivia = useCallback(() => client?.send("agente", { kind: "trivia-cancel" }), [client]);
  const setKey = useCallback(
    (provider: AgentProviderId, key: string) => {
      setTests((t) => ({ ...t, [provider]: undefined }));
      client?.send("agente", { kind: "set-key", provider, key });
    },
    [client],
  );
  const removeKey = useCallback(
    (provider: AgentProviderId) => {
      setTests((t) => ({ ...t, [provider]: undefined }));
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

  return {
    config: data?.config ?? null,
    state: data?.state ?? null,
    keys: data?.keys ?? null,
    modelCalls: data?.modelCalls ?? 0,
    trivia: data?.trivia ?? null,
    serverNow: data?.serverNow ?? 0,
    tests,
    error,
    save,
    reset,
    ask,
    setKey,
    removeKey,
    testConnection,
    startTrivia,
    cancelTrivia,
  };
}
