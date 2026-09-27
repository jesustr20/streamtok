import { useEffect, useState } from "react";
import type { EventLogEntry, EventLogMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";

function relativeTime(at: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - at) / 1000));
  if (diff < 5) return "ahora";
  if (diff < 60) return `hace ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  return `hace ${h}h`;
}

/**
 * Panel "Eventos y Cola" (issue #17): log in-memory, más reciente primero, de
 * lo que pasó al evaluar cada evento (acción disparada o descarte y por qué).
 * Solo lectura: escucha el canal `event-log` del sidecar.
 */
export function EventQueuePanel({ client }: { client: SidecarClient | null }) {
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "event-log") return;
      const msg = evt.payload as EventLogMessage;
      if (msg.kind === "snapshot") {
        setEntries([...msg.entries].reverse());
      } else if (msg.kind === "append") {
        setEntries((prev) => [msg.entry, ...prev]);
      }
    });
    return off;
  }, [client]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.length === 0 ? (
        <div style={{ padding: 12, color: "#5B5D66", fontSize: 12.5 }}>
          Sin eventos todavía. Llegarán acá a medida que se evalúen.
        </div>
      ) : (
        entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              background: "#17181D",
              border: "1px solid #2A2C33",
              borderRadius: 9,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
                background: e.status === "fired" ? "#34D399" : "#E5484D",
              }}
            />
            <span style={{ flex: 1, fontSize: 12.5 }}>{e.message}</span>
            <span style={{ fontSize: 10.5, color: "#5B5D66", whiteSpace: "nowrap" }}>
              {relativeTime(e.at, now)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
