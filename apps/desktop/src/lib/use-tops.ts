import type { TopConfig, TopState, TopsMessage } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { configs: TopConfig[]; states: TopState[] };
// Último estado recibido: al volver a la vista aparece al instante y el diseño no se mueve.
let last: Cached | null = null;

/** Tops (canal WS `tops`, ADR 0017). */
export function useTops(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "tops") return;
      const msg = evt.payload as TopsMessage;
      if (msg.kind === "state") {
        last = { configs: msg.configs, states: msg.states };
        setData(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("tops", { kind: "get-state" });
    return off;
  }, [client]);

  const save = useCallback((config: TopConfig) => client?.send("tops", { kind: "save", config }), [client]);
  const reset = useCallback((id: string) => client?.send("tops", { kind: "reset", id }), [client]);
  const test = useCallback(
    (id: string, name: string, amount: number) => client?.send("tops", { kind: "test", id, name, amount }),
    [client],
  );

  return { configs: data?.configs ?? null, states: data?.states ?? [], error, save, reset, test };
}
