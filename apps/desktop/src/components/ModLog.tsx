import type { ModAckPayload } from "@streamtok/shared";

/** Punto 4 del contrato: "ver los mod-ack (éxito/error) en un log de la app". */
export function ModLog({ entries }: { entries: ModAckPayload[] }) {
  if (entries.length === 0) {
    return <div style={{ fontSize: 12, color: "#5B5D66" }}>Sin actividad todavía.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 4, maxHeight: 260, overflowY: "auto" }}>
      {entries.map((ack, i) => (
        <div
          key={`${ack.id}-${i}`}
          style={{
            fontSize: 11.5,
            padding: "6px 10px",
            borderRadius: 6,
            background: ack.ok ? "#0F1F17" : "#2A1416",
            color: ack.ok ? "#34D399" : "#E5484D",
          }}
        >
          {ack.ok ? "✓" : "✕"} {ack.id} {ack.error ? `— ${ack.error}` : ""}
        </div>
      ))}
    </div>
  );
}
