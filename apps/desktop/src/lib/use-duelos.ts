import type { DuelConfig, DuelState, DuelosMessage } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { configs: DuelConfig[]; states: DuelState[] };
// Último estado recibido: al volver a la vista aparece al instante y el diseño no se mueve.
let last: Cached | null = null;

/** Duelos (canal WS `duelos`, ADR 0015). */
export function useDuelos(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "duelos") return;
      const msg = evt.payload as DuelosMessage;
      if (msg.kind === "state") {
        last = { configs: msg.configs, states: msg.states };
        setData(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("duelos", { kind: "get-state" });
    return off;
  }, [client]);

  const save = useCallback((config: DuelConfig) => client?.send("duelos", { kind: "save", config }), [client]);
  const reset = useCallback((id: string) => client?.send("duelos", { kind: "reset", id }), [client]);
  const adjust = useCallback(
    (id: string, side: 0 | 1, delta: number) => client?.send("duelos", { kind: "adjust", id, side, delta }),
    [client],
  );

  const test = useCallback(
    (id: string, side: 0 | 1, units: number, name: string, coins?: number) =>
      client?.send("duelos", { kind: "test", id, side, units, name, ...(coins ? { coins } : {}) }),
    [client],
  );

  return { configs: data?.configs ?? null, states: data?.states ?? [], error, save, reset, adjust, test };
}
