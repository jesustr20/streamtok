import { useState } from "react";

const ACCENT = "#E23A57";
const OVERLAY_URL = "http://localhost:7331/overlay/mods/gta-v";

/**
 * Sección "Overlay" (ModDetalle.dc.html): URL del overlay + botón copiar.
 */
export function OverlaySection() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(OVERLAY_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      style={{
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
          EMISIÓN
        </span>
        <h2 style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          Overlay para tu stream
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#9A9CA5" }}>
          Pega esta URL como fuente "Link" en TikTok LIVE Studio u OBS.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div
          style={{
            flexGrow: 1,
            display: "flex",
            alignItems: "center",
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 10,
            padding: "0 14px",
            height: 42,
            boxSizing: "border-box",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 12.5, color: "#6B6D76", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {OVERLAY_URL}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: ACCENT,
            color: "#FFFFFF",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
          }}
        >
          {copied ? "✓ Copiado" : "Copiar URL"}
        </button>
      </div>
    </div>
  );
}
