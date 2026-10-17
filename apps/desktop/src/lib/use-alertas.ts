import type { AlertConfig, AlertKind, AlertasMessage } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

type Cached = { configs: AlertConfig[]; joinGiftNames: string[] };
// Último estado recibido: al volver a la vista aparece al instante y el diseño no se mueve.
let last: Cached | null = null;

/** Alertas de comunidad y nivel (canal WS `alertas`, ADR 0014). */
export function useAlertas(client: SidecarClient | null) {
  const [data, setData] = useState<Cached | null>(last);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "alertas") return;
      const msg = evt.payload as AlertasMessage;
      if (msg.kind === "state") {
        last = { configs: msg.configs, joinGiftNames: msg.joinGiftNames };
        setData(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("alertas", { kind: "get-state" });
    return off;
  }, [client]);

  const save = useCallback((config: AlertConfig) => client?.send("alertas", { kind: "save", config }), [client]);
  const setJoinGifts = useCallback((names: string[]) => client?.send("alertas", { kind: "set-join-gifts", names }), [client]);
  const test = useCallback((alertKind: AlertKind) => client?.send("alertas", { kind: "test", alertKind }), [client]);

  return { configs: data?.configs ?? null, joinGiftNames: data?.joinGiftNames ?? [], error, save, setJoinGifts, test };
}
