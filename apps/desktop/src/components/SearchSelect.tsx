import { useEffect, useRef, useState, type ReactNode } from "react";
import { matchesQuery } from "../lib/search";

export interface SearchSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Lista desplegable con caja "Buscar…" arriba. Filtra sin distinguir
 * mayúsculas ni tildes. Enter elige la primera coincidencia, Escape cierra.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder = "Seleccionar…",
  height = 32,
  fontSize = 12,
}: {
  value: string;
  options: SearchSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  height?: number;
  fontSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) => matchesQuery(o.label, query));

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...triggerStyle, height, fontSize, color: selected ? "#F4F4F5" : "#5B5D66" }}
      >
        {selected?.icon}
        <span style={labelStyle}>{selected ? selected.label : placeholder}</span>
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={() => setOpen(false)} />
          <div style={dropdownStyle}>
            <input
              ref={inputRef}
              value={query}
              placeholder="Buscar…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered[0]) pick(filtered[0].value);
              }}
              style={searchStyle}
            />
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "8px", fontSize: 11.5, color: "#5B5D66" }}>Sin resultados</div>
              ) : (
                filtered.map((o) => {
                  const active = o.value === value || hovered === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onMouseEnter={() => setHovered(o.value)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => pick(o.value)}
                      style={{
                        ...optionStyle,
                        fontSize,
                        background: active ? "#1E2027" : "transparent",
                        color: active ? "#F4F4F5" : "#9A9CA5",
                      }}
                    >
                      {o.icon}
                      <span style={labelStyle}>{o.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  cursor: "pointer",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 16,
  display: "flex",
  flexDirection: "column",
  maxHeight: 260,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  boxShadow: "0 12px 32px #00000080",
  padding: 4,
  gap: 4,
  boxSizing: "border-box",
};

const searchStyle: React.CSSProperties = {
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 6,
  color: "#F4F4F5",
  fontSize: 12,
  padding: "6px 8px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
};

const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 8px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
