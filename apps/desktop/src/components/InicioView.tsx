import { useState } from "react";

const ACCENT = "#E23A57";

type Tab = "gratuita" | "apiKey";

/**
 * Pantalla "Inicio" (Main.dc.html): tarjeta de conexión con tabs de método
 * (Conexión gratuita / Con API key propia), campo de usuario con prefijo @,
 * campo de API key (deshabilitado en el tab gratuito), botones Conectar/
 * Desconectar y el aviso "¿Se cortó la conexión en pleno show?".
 *
 * La conexión real al LIVE aún no tiene backend (el sidecar arranca la fuente
 * solo con TIKTOK_USERNAME); acá se mantiene la estructura visual completa y
 * un estado local de conexión.
 */
export function InicioView({ onGoJuegos }: { onGoJuegos: () => void }) {
  const [tab, setTab] = useState<Tab>("gratuita");
  const [username, setUsername] = useState("");
  const [connected, setConnected] = useState(false);

  const tabHint =
    tab === "gratuita"
      ? 'Usa el nivel gratuito de la comunidad (Euler Stream) para firmar la conexión al LIVE. Puede dar límite de reintentos en horas pico — si te pasa seguido, cambia a la pestaña "Con API key propia".'
      : "Usa tu propia API key de Euler Stream para firmar la conexión al LIVE. Recomendado si haces shows largos o en horas pico.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
            Inicio
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#9A9CA5" }}>
            Conecta tu cuenta de TikTok para empezar a recibir regalos, likes y comentarios en tiempo real.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B6D76", fontSize: 12.5 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34D399" }} />
          <span>Sidecar activo · puerto 7331</span>
        </div>
      </div>

      {/* tarjeta de conexión */}
      <div
        style={{
          padding: 0,
          background: "#17181D",
          border: "1px solid #2A2C33",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {/* tabs */}
        <div style={{ display: "flex", gap: 24, padding: "0 22px", borderBottom: "1px solid #2A2C33" }}>
          <button
            type="button"
            onClick={() => setTab("gratuita")}
            style={tabStyle(tab === "gratuita")}
          >
            Conexión gratuita
          </button>
          <button
            type="button"
            onClick={() => setTab("apiKey")}
            style={tabStyle(tab === "apiKey")}
          >
            Con API key propia
          </button>
        </div>

        <div style={{ padding: "24px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "#9A9CA5", lineHeight: 1.5 }}>{tabHint}</p>

          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
              <label htmlFor="tt-user" style={{ fontSize: 12, fontWeight: 600, color: "#C4C5CC" }}>
                Usuario de TikTok <span style={{ color: "#E5484D" }}>(Requerido)</span>
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#0E0F12",
                  border: "1px solid #2A2C33",
                  borderRadius: 10,
                  padding: "0 14px",
                  height: 44,
                  boxSizing: "border-box",
                }}
              >
                <span style={{ color: "#5B5D66", fontSize: 14, marginRight: 2 }}>@</span>
                <input
                  id="tt-user"
                  type="text"
                  placeholder="tu_usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{
                    flexGrow: 1,
                    background: "transparent",
                    border: "none",
                    color: "#F4F4F5",
                    fontSize: 13.5,
                    height: "100%",
                    padding: 0,
                    outline: "none",
                    fontFamily: "'Manrope', sans-serif",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#C4C5CC" }}>
                API key de firma (Euler Stream) <span style={{ color: "#5B5D66" }}>— opcional</span>
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  background: "#0E0F12",
                  border: "1px solid #2A2C33",
                  borderRadius: 10,
                  padding: "0 14px",
                  height: 44,
                  boxSizing: "border-box",
                  opacity: tab === "apiKey" ? 1 : 0.4,
                }}
              >
                <input
                  type="text"
                  placeholder={tab === "apiKey" ? "tu_api_key" : "Solo en la pestaña 'Con API key propia'"}
                  disabled={tab !== "apiKey"}
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
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setConnected(true)}
              style={{
                padding: "0 24px",
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                background: ACCENT,
                color: "#FFFFFF",
                fontSize: 13.5,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
              }}
            >
              Conectar
            </button>
            <button
              type="button"
              onClick={() => setConnected(false)}
              style={{
                padding: "0 20px",
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                background: "#1E2027",
                color: connected ? "#C4C5CC" : "#5B5D66",
                fontSize: 13.5,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
              }}
            >
              Desconectar
            </button>
          </div>
        </div>
      </div>

      {/* si la conexión falla */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "16px 18px",
          background: "#141922",
          border: "1px solid #22303F",
          borderRadius: 14,
        }}
      >
        <span style={{ fontSize: 16 }}>🎮</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>¿Se cortó la conexión en pleno show?</div>
          <div style={{ fontSize: 12, color: "#9A9CA5", marginTop: 2, lineHeight: 1.5 }}>
            Mientras reconectas, puedes seguir el show a mano desde{" "}
            <button
              type="button"
              onClick={onGoJuegos}
              style={{ color: "#5B7CFA", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12 }}
            >
              Simulador de Eventos
            </button>{" "}
            — dispara efectos manualmente sin depender del LIVE real.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B5D66" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span style={{ fontSize: 12, color: "#6B6D76" }}>
          Necesitas estar en vivo en TikTok para que la conexión funcione. Sin iniciar sesión, sin OAuth.
        </span>
      </div>
    </div>
  );
}

function tabStyle(sel: boolean): React.CSSProperties {
  return {
    padding: "16px 0",
    fontSize: 13.5,
    fontWeight: 700,
    color: sel ? ACCENT : "#6B6D76",
    borderBottom: `2px solid ${sel ? ACCENT : "transparent"}`,
    background: "none",
    borderTop: "none",
    borderLeft: "none",
    borderRight: "none",
    cursor: "pointer",
  };
}
