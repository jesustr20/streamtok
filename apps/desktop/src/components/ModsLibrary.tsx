import { useState } from "react";
import type { ModHelloPayload } from "@streamtok/shared";

const ACCENT = "#E23A57";

const FILTERS = [
  { label: "Todos", active: true },
  { label: "Acción", active: false },
  { label: "Sandbox", active: false },
  { label: "Supervivencia", active: false },
];

/**
 * Pantalla "Mods" (Mods.dc.html): header + buscador, fila de filtros (pills) y
 * grid de 3 columnas de tarjetas de mod. Hoy solo hay un mod real (GTA V Chaos
 * Mod, con datos del WS `mod-hello`); el resto de la grilla es un placeholder
 * "Más mods próximamente".
 */
export function ModsLibrary({
  catalog,
  onOpenMod,
}: {
  catalog: ModHelloPayload | null;
  onOpenMod: () => void;
}) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("Todos");

  const comandos = catalog?.actions.length ?? 0;
  const realMod = {
    title: "GTA V Chaos Mod",
    coverBg: "#5B7CFA",
    coverLabel: "GTA V",
    status: "INSTALADO",
    statusBg: "#123524",
    statusColor: "#34D399",
    stat: `${comandos} ${comandos === 1 ? "comando disponible" : "comandos disponibles"}`,
  };

  const visible = realMod.title.toLowerCase().includes(search.toLowerCase());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            Mods
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#9A9CA5" }}>
            Conecta tus regalos y comentarios directo al juego que estás jugando.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#17181D",
            border: "1px solid #2A2C33",
            borderRadius: 10,
            padding: "0 14px",
            height: 40,
            width: 260,
            boxSizing: "border-box",
          }}
        >
          <span style={{ color: "#5B5D66", fontSize: 13, marginRight: 8 }}>⌕</span>
          <input
            type="text"
            placeholder="Buscar mod..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flexGrow: 1,
              background: "transparent",
              border: "none",
              color: "#F4F4F5",
              fontSize: 13,
              height: "100%",
              padding: 0,
              outline: "none",
              fontFamily: "'Manrope', sans-serif",
            }}
          />
        </div>
      </div>

      {/* filtros */}
      <div style={{ display: "flex", gap: 8 }}>
        {FILTERS.map((f) => {
          const sel = f.label === activeFilter;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => setActiveFilter(f.label)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                background: sel ? ACCENT : "#17181D",
                color: sel ? "#FFFFFF" : "#9A9CA5",
                fontSize: 12.5,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* grid de mods */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
        {visible && (
          <button
            type="button"
            onClick={onOpenMod}
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#17181D",
              border: "1px solid #2A2C33",
              borderRadius: 14,
              overflow: "hidden",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "#F4F4F5",
            }}
          >
            <div
              style={{
                height: 110,
                background: realMod.coverBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#FFFFFF",
                  letterSpacing: "-0.01em",
                }}
              >
                {realMod.coverLabel}
              </span>
            </div>
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{realMod.title}</span>
                <div
                  style={{
                    padding: "2px 9px",
                    borderRadius: 6,
                    background: realMod.statusBg,
                    color: realMod.statusColor,
                    fontSize: 10.5,
                    fontWeight: 700,
                  }}
                >
                  {realMod.status}
                </div>
              </div>
              <span style={{ fontSize: 12, color: "#9A9CA5" }}>{realMod.stat}</span>
            </div>
          </button>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            minHeight: 180,
            border: "1px dashed #2A2C33",
            borderRadius: 14,
            color: "#5B5D66",
            fontSize: 12.5,
            background: "transparent",
          }}
        >
          <span style={{ fontSize: 18 }}>＋</span>
          <span>Más mods próximamente</span>
        </div>
      </div>
    </div>
  );
}
