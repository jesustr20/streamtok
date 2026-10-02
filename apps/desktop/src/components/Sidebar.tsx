import type { ViewId } from "../App";

type NavItem = {
  id: string;
  label: string;
  enabled: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { id: "inicio", label: "Inicio", enabled: true },
  { id: "live", label: "Live", enabled: false },
  { id: "juegos", label: "Juegos", enabled: true },
  { id: "overlays", label: "Overlays", enabled: false },
  { id: "tienda", label: "Tienda", enabled: false },
  { id: "ajustes", label: "Ajustes", enabled: false },
];

/**
 * Barra lateral de navegación. Por ahora solo "Inicio" y "Juegos" navegan;
 * el resto se ven pero deshabilitados con etiqueta "Próximamente" (issue #24).
 */
export function Sidebar({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        padding: "24px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        borderRight: "1px solid #2A2C33",
        background: "#14151A",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 20px" }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: "#E23A57" }} />
        <span style={{ fontSize: 16, fontWeight: 700 }}>StreamTok</span>
      </div>

      {NAV_ITEMS.map((item) => {
        const active = item.enabled && view === item.id;
        const clickable = item.enabled;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!clickable}
            onClick={() => onNavigate(item.id as ViewId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
              padding: "9px 12px",
              borderRadius: 8,
              background: active ? "#1F222B" : "transparent",
              border: "none",
              color: active ? "#F4F4F5" : clickable ? "#C4C5CC" : "#5B5D66",
              fontSize: 13.5,
              fontWeight: active ? 700 : 500,
              cursor: clickable ? "pointer" : "default",
            }}
          >
            <span style={{ flex: 1 }}>{item.label}</span>
            {!clickable && (
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
    </aside>
  );
}
