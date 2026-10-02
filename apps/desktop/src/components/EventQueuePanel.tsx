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
 * Panel "Eventos y Cola" (ModDetalle.dc.html): log in-memory, más reciente
 * primero, de lo que pasó al evaluar cada evento (acción disparada o descarte
 * y por qué). Solo lectura: escucha el canal `event-log` del sidecar.
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
    <div
      style={{
        flex: 1,
        padding: 22,
        background: "#17181D",
        border: "1px solid #2A2C33",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#5B7CFA", letterSpacing: "0.06em" }}>
            REGALOS Y EVENTOS
          </span>
          <h2 style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            Eventos y Cola
          </h2>
        </div>
        <div
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            fontSize: 11,
            fontWeight: 700,
            color: "#9A9CA5",
          }}
        >
          En cola: 0
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: "10px 12px", background: "#0E0F12", border: "1px solid #2A2C33", borderRadius: 9, fontSize: 12, color: "#5B5D66" }}>
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
              padding: "10px 12px",
              background: "#0E0F12",
              border: "1px solid #2A2C33",
              borderRadius: 9,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: e.status === "fired" ? "#34D399" : "#E5484D",
                flexShrink: 0,
              }}
            />
            <span style={{ flexGrow: 1, fontSize: 12, color: "#C4C5CC" }}>{e.message}</span>
            <span style={{ fontSize: 11, color: "#5B5D66", whiteSpace: "nowrap" }}>
              {relativeTime(e.at, now)}
            </span>
          </div>
        ))
      )}

      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#5B5D66", lineHeight: 1.5 }}>
        Si el mod no está cargado en el juego, el evento no se aplica y queda marcado como descartado acá — nunca falla en silencio.
      </p>
    </div>
  );
}
