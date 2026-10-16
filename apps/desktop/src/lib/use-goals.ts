import type { Goal, GoalConfig, GoalOp, GoalsMessage } from "@streamtok/shared";
import { useCallback, useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

/** Metas (canal WS `goals`, ADR 0012). */
export function useGoals(client: SidecarClient | null) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "goals") return;
      const msg = evt.payload as GoalsMessage;
      if (msg.kind === "state") {
        setGoals(msg.goals);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("goals", { kind: "get-state" });
    return off;
  }, [client]);

  const save = useCallback((config: GoalConfig) => client?.send("goals", { kind: "save", config }), [client]);
  const remove = useCallback((id: string) => client?.send("goals", { kind: "remove", id }), [client]);
  const control = useCallback(
    (id: string, op: GoalOp, value?: number) => client?.send("goals", { kind: "goal-control", id, op, value }),
    [client],
  );

  return { goals, error, save, remove, control };
}
