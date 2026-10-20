import type { AgentConfig, AgentMessage, AgentState } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { config: AgentConfig; state: AgentState; serverNow: number };
// Último estado recibido: al volver a la vista aparece al instante.
let last: Cached | null = null;

/** Agente IA (canal WS `agente`, ADR 0016). */
export function useAgente(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "agente") return;
      const msg = evt.payload as AgentMessage;
      if (msg.kind === "state") {
        last = { config: msg.config, state: msg.state, serverNow: msg.serverNow };
        setData(last);
        setError(null);
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

  return { config: data?.config ?? null, state: data?.state ?? null, serverNow: data?.serverNow ?? 0, error, save, reset, ask };
}
