import { useState } from "react";

/**
 * Panel "Configurar Eventos" (ModDetalle.dc.html): límites anti-abuso por
 * usuario. Sin canal WS todavía — estado local, estructura visual completa.
 */
export function ConfigurarEventos() {
  const [maxFollows, setMaxFollows] = useState("1");
  const [maxShares, setMaxShares] = useState("999999");

  return (
    <div
      style={{
        flex: 0.8,
        padding: 22,
        background: "#17181D",
        border: "1px solid #2A2C33",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#F5A623", letterSpacing: "0.06em" }}>
          ANTI-ABUSO
        </span>
        <h2 style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          Configurar Eventos
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#9A9CA5" }}>
          Límite por usuario para este juego.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>Máximo de Follows por usuario</label>
        <input
          type="text"
          value={maxFollows}
          onChange={(e) => setMaxFollows(e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>Máximo de Shares por usuario</label>
        <input
          type="text"
          value={maxShares}
          onChange={(e) => setMaxShares(e.target.value)}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  height: 36,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  padding: "0 12px",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
  boxSizing: "border-box",
};
