import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { matchesQuery } from "../lib/search";

export interface SearchSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Lista desplegable con caja "Buscar…" arriba. Filtra sin distinguir
 * mayúsculas ni tildes. Enter elige la primera coincidencia, Escape cierra.
 *
 * La lista se dibuja fuera del contenedor (portal + position fixed) para que no la recorte ningún
 * `overflow: hidden` de los modales; se abre hacia arriba si abajo no cabe.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) => matchesQuery(o.label, query));

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPos(null);
    }
  }, [open]);
  useEffect(() => {
    if (pos) inputRef.current?.focus(); // el campo existe solo cuando la lista ya está colocada
  }, [pos]);

  // Coloca la lista junto al botón (debajo, o encima si abajo no hay sitio) y la cierra si algo se mueve.
  useEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const up = below < 200 && r.top > below;
    const maxHeight = Math.max(120, Math.min(260, (up ? r.top : below) - 8));
    setPos(
      up
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight }
        : { left: r.left, width: r.width, top: r.bottom + 4, maxHeight },
    );
    const close = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return; // scroll de la propia lista
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...triggerStyle, height, fontSize, color: selected ? "#F4F4F5" : "#5B5D66" }}
      >
        {selected?.icon}
        <span style={labelStyle}>{selected ? selected.label : placeholder}</span>
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>

      {open && pos && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 1000 }} onClick={() => setOpen(false)} />
          <div ref={listRef} style={{ ...dropdownStyle, ...pos }}>
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
        </>,
        document.body,
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
  position: "fixed",
  zIndex: 1001,
  display: "flex",
  flexDirection: "column",
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
