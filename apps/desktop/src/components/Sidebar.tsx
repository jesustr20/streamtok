import type { ViewId } from "../App";

type NavItem = {
  id: string;
  label: string;
  enabled: boolean;
};

/**
 * Orden y etiquetas fieles a los .dc.html (Main/Mods/ModDetalle/ModPerfiles).
 * Solo "Inicio" y "Juegos" navegan; el resto se ve deshabilitado con etiqueta
 * "Próximamente".
 */
const NAV_ITEMS: NavItem[] = [
  { id: "inicio", label: "Inicio", enabled: true },
  { id: "live", label: "Live", enabled: false },
  { id: "overlays", label: "Overlays", enabled: false },
  { id: "simulador", label: "Simulador", enabled: false },
  { id: "alertas", label: "Alertas", enabled: false },
  { id: "puntos", label: "Puntos", enabled: false },
  { id: "juegos", label: "Juegos", enabled: true },
  { id: "suscripciones", label: "Suscripciones", enabled: false },
  { id: "admin", label: "Admin", enabled: false },
];

const ACCENT = "#E23A57";

export function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        boxSizing: "border-box",
        padding: "28px 16px",
        borderRight: "1px solid #22242B",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: ACCENT }} />
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          StreamTok
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const active =
            item.enabled &&
            (view === item.id ||
              ((view === "juego-detalle" || view === "gestionar-perfiles") && item.id === "juegos"));
          return (
            <button
              key={item.id}
              type="button"
              disabled={!item.enabled}
              onClick={() => onNavigate(item.id as ViewId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                background: active ? "#1E2027" : "transparent",
                border: "none",
                color: active ? "#FFFFFF" : "#9A9CA5",
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                cursor: item.enabled ? "pointer" : "default",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: active ? ACCENT : "#3A3C44",
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{item.label}</span>
              {!item.enabled && (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#9A9CA5",
                    background: "#23252C",
                    padding: "2px 6px",
                    borderRadius: 4,
                    letterSpacing: "0.02em",
                  }}
                >
                  Próximamente
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
