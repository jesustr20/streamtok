import type { AgentMemoryMessage, Conducta, Pendiente, StreamerMemory } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Ignored = { handle: string; name: string; strikes: number };
type Cached = { streamer: StreamerMemory; viewerCount: number; conductas: Conducta[]; ignored: Ignored[]; pendientes: Pendiente[] };
// Último estado recibido: al volver a la vista aparece al instante.
let last: Cached | null = null;

/** Memoria del agente (canal WS `agente-memoria`, ADR 0024): ficha del streamer y viewers recordados. */
export function useAgenteMemoria(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "agente-memoria") return;
      const msg = evt.payload as AgentMemoryMessage;
      if (msg.kind === "state") {
        last = { streamer: msg.streamer, viewerCount: msg.viewerCount, conductas: msg.conductas ?? [], ignored: msg.ignored ?? [], pendientes: msg.pendientes ?? [] };
        setData(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("agente-memoria", { kind: "get-state" });
    return off;
  }, [client]);

  const send = useCallback((m: AgentMemoryMessage) => client?.send("agente-memoria", m), [client]);
  return {
    streamer: data?.streamer ?? null,
    viewerCount: data?.viewerCount ?? 0,
    conductas: data?.conductas ?? [],
    ignored: data?.ignored ?? [],
    pendientes: data?.pendientes ?? [],
    error,
    saveStreamer: (name: string, aliases: string[]) => send({ kind: "save-streamer", name, aliases }),
    addFact: (text: string) => send({ kind: "add-fact", text }),
    removeFact: (id: string) => send({ kind: "remove-fact", id }),
    clearViewers: () => send({ kind: "clear-viewers" }),
    removeConducta: (id: string) => send({ kind: "remove-conducta", id }),
    forgive: (handle: string) => send({ kind: "forgive-viewer", handle }),
    answerPending: (id: string, text: string) => send({ kind: "answer-pending", id, text }),
    dismissPending: (id: string, decline: boolean) => send({ kind: "dismiss-pending", id, decline }),
  };
}
