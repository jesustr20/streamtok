import type { OverlaysConfig, OverlaysMessage, OverlaysState } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

// Último estado recibido: al volver a una vista se muestra al instante y el diseño no se mueve.
let last: { state: OverlaysState; config: OverlaysConfig } | null = null;

/** Estado y configuración de los overlays (canal WS `overlays`, ADR 0011). */
export function useOverlays(client: SidecarClient | null) {
  const [state, setState] = useState<OverlaysState | null>(last?.state ?? null);
  const [config, setConfig] = useState<OverlaysConfig | null>(last?.config ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "overlays") return;
      const msg = evt.payload as OverlaysMessage;
      if (msg.kind === "state") {
        last = { state: msg.state, config: msg.config };
        setState(msg.state);
        setConfig(msg.config);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("overlays", { kind: "get-state" });
    return off;
  }, [client]);

  const timerControl = useCallback(
    (op: string, seconds?: number) => client?.send("overlays", { kind: "timer-control", op, seconds }),
    [client],
  );
  const winsControl = useCallback(
    (op: string, value?: number | string) => client?.send("overlays", { kind: "wins-control", op, value }),
    [client],
  );
  const saveConfig = useCallback(
    (next: OverlaysConfig) => {
      setConfig(next); // optimista; el sidecar confirma con `state`
      client?.send("overlays", { kind: "set-config", config: next });
    },
    [client],
  );

  return { state, config, error, timerControl, winsControl, saveConfig };
}

export type Ov = ReturnType<typeof useOverlays>;
