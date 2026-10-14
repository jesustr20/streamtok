import { Fragment, useState } from "react";
import type { GiftCatalogEntry } from "@streamtok/shared";

/** "1 Coins - ID:10716" (el ID se omite si el regalo del catálogo no lo trae). */
function giftSubtitle(g: GiftCatalogEntry): string {
  return g.id ? `${g.cost} Coins - ID:${g.id}` : `${g.cost} Coins`;
}

/** Regalo que ya llegó por un LIVE real (trae el id que da TikTok). */
function isConfirmed(g: GiftCatalogEntry): boolean {
  return !!g.id;
}

const byName = (a: GiftCatalogEntry, b: GiftCatalogEntry) => a.name.localeCompare(b.name);

/** Referencia a un regalo elegido: el id manda (hay regalos con el MISMO nombre
 * y distinto id, p. ej. dos "Balloons"); sin id solo se conoce el nombre. */
export interface GiftRef {
  id?: string;
  name: string;
}

export const giftRefOf = (g: GiftCatalogEntry): GiftRef => ({ id: g.id, name: g.name });

/** Busca en el catálogo el regalo al que apunta `ref`: por id si lo trae; si ese
 * id aún no está en el catálogo (o la referencia no tiene id), por nombre. */
export function findGift(gifts: GiftCatalogEntry[], ref: GiftRef | null): GiftCatalogEntry | undefined {
  if (!ref) return undefined;
  if (ref.id) {
    const byId = gifts.find((g) => g.id === ref.id);
    if (byId) return byId;
  }
  return gifts.find((g) => g.name === ref.name);
}

/** Clave estable: el id si lo hay; si no, nombre + costo (hay nombres repetidos). */
const giftKey = (g: GiftCatalogEntry) => g.id ?? `${g.name}|${g.cost}`;

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
  value: GiftRef | null;
  gifts: GiftCatalogEntry[];
  onSelect: (gift: GiftCatalogEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = findGift(gifts, value);

  const q = query.trim().toLowerCase();
  const matching = q
    ? gifts.filter((g) => g.name.toLowerCase().includes(q) || (g.id ?? "").includes(q))
    : gifts;
  // Primero los que ya llegaron por un LIVE (confirmados, con id), luego el
  // catálogo sembrado (sin id). La lista se recalcula sola cuando el sidecar
  // aprende o actualiza un regalo, aunque el desplegable esté abierto.
  const confirmed = matching.filter(isConfirmed).sort(byName);
  const unconfirmed = matching.filter((g) => !isConfirmed(g));
  const visible = [...confirmed, ...unconfirmed];

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
              <span style={giftSubtitleStyle}>
                {giftSubtitle(selected)}
                {!isConfirmed(selected) && <span style={unconfirmedBadgeStyle}>sin confirmar</span>}
              </span>
            </span>
          </>
        ) : (
          <span style={{ flex: 1, textAlign: "left", fontSize: 12.5, color: "#5B5D66" }}>
            Elegir regalo…
          </span>
        )}
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>
      {selected && !isConfirmed(selected) && (
        <div style={unconfirmedNoteStyle}>
          Este regalo aún no ha llegado por ningún LIVE, así que se reconoce solo por su nombre. Si
          TikTok lo llama distinto, no disparará. Cuando llegue, aparecerá aquí con su id.
        </div>
      )}

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
              visible.map((g, i) => {
                const isSelected = g === selected;
                const firstOfGroup = i === 0 || isConfirmed(g) !== isConfirmed(visible[i - 1]);
                const header =
                  firstOfGroup && confirmed.length > 0 && unconfirmed.length > 0
                    ? isConfirmed(g)
                      ? `Recibidos en tus LIVEs (${confirmed.length})`
                      : `Catálogo sin confirmar (${unconfirmed.length})`
                    : null;
                return (
                  <Fragment key={giftKey(g)}>
                    {header && <div style={giftGroupHeaderStyle}>{header}</div>}
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(g);
                        close();
                      }}
                      style={{ ...giftOptionStyle, background: isSelected ? "#1E2027" : "transparent" }}
                    >
                      <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" style={giftThumbStyle} />
                      <span style={giftTextColumnStyle}>
                        <span style={{ ...giftNameStyle, color: isSelected ? "#F4F4F5" : "#C4C5CC" }}>{g.name}</span>
                        <span style={giftSubtitleStyle}>
                          {giftSubtitle(g)}
                          {!isConfirmed(g) && <span style={unconfirmedBadgeStyle}>sin confirmar</span>}
                        </span>
                      </span>
                    </button>
                  </Fragment>
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

const unconfirmedBadgeStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 9.5,
  fontWeight: 700,
  color: "#F5A524",
  background: "#F5A5241A",
  textTransform: "uppercase",
  letterSpacing: 0.3,
};

const unconfirmedNoteStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  lineHeight: 1.5,
  color: "#F5A524",
};

const giftGroupHeaderStyle: React.CSSProperties = {
  padding: "8px 8px 4px",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "#6B6D76",
  flexShrink: 0,
};
