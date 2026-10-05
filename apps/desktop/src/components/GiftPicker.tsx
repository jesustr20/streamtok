import { useState } from "react";
import type { GiftCatalogEntry } from "@streamtok/shared";

/** "1 Coins - ID:10716" (el ID se omite si el regalo del catálogo no lo trae). */
function giftSubtitle(g: GiftCatalogEntry): string {
  return g.id ? `${g.cost} Coins - ID:${g.id}` : `${g.cost} Coins`;
}

/**
 * Selector de regalo del catálogo (imagen + nombre + monedas + ID, con
 * buscador). Compartido por el modal de Evento ("regalo específico") y por
 * "Simular Eventos", para que ambos muestren la misma lista.
 */
export function GiftPicker({
  value,
  gifts,
  onSelect,
}: {
  value: string;
  gifts: GiftCatalogEntry[];
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = gifts.find((g) => g.name === value);

  const q = query.trim().toLowerCase();
  const visible = q
    ? gifts.filter((g) => g.name.toLowerCase().includes(q) || (g.id ?? "").includes(q))
    : gifts;

  function close() {
    setOpen(false);
    setQuery("");
  }

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={giftPickerButtonStyle}>
        {selected ? (
          <>
            <img src={selected.imageUrl} alt="" referrerPolicy="no-referrer" style={giftThumbStyle} />
            <span style={giftTextColumnStyle}>
              <span style={giftNameStyle}>{selected.name}</span>
              <span style={giftSubtitleStyle}>{giftSubtitle(selected)}</span>
            </span>
          </>
        ) : (
          <span style={{ flex: 1, textAlign: "left", fontSize: 12.5, color: "#5B5D66" }}>
            Elegir regalo…
          </span>
        )}
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={close} />
          <div style={giftDropdownStyle}>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              style={giftSearchStyle}
            />
            {visible.length === 0 ? (
              <div style={{ padding: "10px 8px", fontSize: 12, color: "#5B5D66" }}>
                Ningún regalo coincide.
              </div>
            ) : (
              visible.map((g) => {
                const isSelected = g.name === value;
                return (
                  <button
                    key={g.id ?? g.name}
                    type="button"
                    onClick={() => {
                      onSelect(g.name);
                      close();
                    }}
                    style={{ ...giftOptionStyle, background: isSelected ? "#1E2027" : "transparent" }}
                  >
                    <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" style={giftThumbStyle} />
                    <span style={giftTextColumnStyle}>
                      <span style={{ ...giftNameStyle, color: isSelected ? "#F4F4F5" : "#C4C5CC" }}>{g.name}</span>
                      <span style={giftSubtitleStyle}>{giftSubtitle(g)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

const giftPickerButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  cursor: "pointer",
  color: "#F4F4F5",
  boxSizing: "border-box",
};

const giftThumbStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 4,
  objectFit: "cover",
  flexShrink: 0,
};

const giftTextColumnStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  minWidth: 0,
  textAlign: "left",
};

const giftNameStyle: React.CSSProperties = {
  maxWidth: "100%",
  fontSize: 12.5,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const giftSubtitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9A9CA5",
  whiteSpace: "nowrap",
};

const giftDropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 16,
  display: "flex",
  flexDirection: "column",
  maxHeight: 280,
  overflowY: "auto",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  boxShadow: "0 12px 32px #00000080",
  padding: 4,
  boxSizing: "border-box",
};

const giftSearchStyle: React.CSSProperties = {
  height: 32,
  margin: "2px 2px 6px",
  padding: "0 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 6,
  color: "#F4F4F5",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
  flexShrink: 0,
};

const giftOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 8px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};
