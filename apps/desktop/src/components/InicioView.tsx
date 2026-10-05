import type { TiktokConnectionMessage, TiktokConnectionState } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "../lib/ws-client";

const ACCENT = "#E23A57";

type Tab = "gratuita" | "apiKey";

/**
 * Pantalla "Inicio" (Main.dc.html): tarjeta de conexión con tabs de método
 * (Conexión gratuita / Con API key propia), campo de usuario con prefijo @,
 * campo de API key (deshabilitado en el tab gratuito), botones Conectar/
 * Desconectar y el aviso "¿Se cortó la conexión en pleno show?".
 *
 * "Conectar" le pide al sidecar (canal WS `tiktok-connection`) que se conecte al
 * LIVE del usuario. Mientras está conectado, el sidecar graba TODOS los
 * mensajes crudos del LIVE en un archivo aparte (recordings/), útil para
 * conectarse a lives de batallas y recopilar datos reales.
 */
export function InicioView({
  client,
  onGoJuegos,
}: {
  client: SidecarClient | null;
  onGoJuegos: () => void;
}) {
  const [tab, setTab] = useState<Tab>("gratuita");
  const [username, setUsername] = useState("");
  const [conn, setConn] = useState<TiktokConnectionState>({ status: "idle", recordedEvents: 0 });

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "tiktok-connection") return;
      const msg = evt.payload as TiktokConnectionMessage;
      if (msg.kind !== "state") return;
      setConn(msg.state);
      // Si la app se abre con una conexión ya activa, muestra su usuario.
      if (msg.state.username) setUsername((current) => current || msg.state.username!);
    });
    // Snapshot bajo demanda (el estado inicial puede haber llegado antes de montar).
    client.send("tiktok-connection", { kind: "get-state" });
    return off;
  }, [client]);

  const busy = conn.status === "connecting";
  const connected = conn.status === "connected";
  const canConnect = !!client && !busy && username.trim().replace(/^@+/, "") !== "";

  function connect() {
    client?.send("tiktok-connection", { kind: "connect", username });
  }
  function disconnect() {
    client?.send("tiktok-connection", { kind: "disconnect" });
  }

  const tabHint =
    tab === "gratuita"
      ? 'Usa el nivel gratuito de la comunidad (Euler Stream) para firmar la conexión al LIVE. Puede dar límite de reintentos en horas pico (más adelante podrás usar tu propia API key).'
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
          {/* Todavía no se envía la clave al sidecar: todas las conexiones usan el
              nivel gratuito. Se habilita cuando se implemente (ver pendientes). */}
          <button
            type="button"
            disabled
            title="Próximamente: usar tu propia clave de firma de Euler Stream"
            style={{ ...tabStyle(false), cursor: "default", opacity: 0.55 }}
          >
            Con API key propia · Próximamente
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canConnect) connect();
                  }}
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
                  placeholder={tab === "apiKey" ? "tu_api_key" : "Próximamente"}
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
              disabled={!canConnect}
              onClick={connect}
              style={{
                opacity: canConnect ? 1 : 0.5,
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
                cursor: canConnect ? "pointer" : "default",
              }}
            >
              {busy ? "Conectando…" : connected ? "Reconectar" : "Conectar"}
            </button>
            <button
              type="button"
              disabled={conn.status === "idle" || !client}
              onClick={disconnect}
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

      {/* estado de la conexión + grabación */}
      <ConnectionStatus conn={conn} />

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

const STATUS_STYLE: Record<TiktokConnectionState["status"], { color: string; label: string }> = {
  idle: { color: "#5B5D66", label: "Sin conexión" },
  connecting: { color: "#F5A524", label: "Conectando…" },
  connected: { color: "#34D399", label: "Conectado" },
  error: { color: "#E5484D", label: "No se pudo conectar" },
};

function ConnectionStatus({ conn }: { conn: TiktokConnectionState }) {
  const { color, label } = STATUS_STYLE[conn.status];
  const showRecording = conn.recordingPath && (conn.status === "connecting" || conn.status === "connected" || conn.recordedEvents > 0);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 18px",
        background: "#17181D",
        border: "1px solid #2A2C33",
        borderRadius: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          {label}
          {conn.username && conn.status !== "idle" ? ` · @${conn.username}` : ""}
        </span>
      </div>
      {conn.status === "error" && conn.error && (
        <div style={{ fontSize: 12.5, color: "#F2A0A3", lineHeight: 1.5 }}>{conn.error}</div>
      )}
      {showRecording && (
        <div style={{ fontSize: 12, color: "#9A9CA5", lineHeight: 1.6 }}>
          {conn.status === "connected" ? "Grabando todos los eventos del LIVE" : "Grabación de esta sesión"}
          {" · "}
          <strong style={{ color: "#C4C5CC" }}>{conn.recordedEvents.toLocaleString("es")}</strong> mensajes
          <div style={{ color: "#6B6D76", wordBreak: "break-all" }}>{conn.recordingPath}</div>
        </div>
      )}
      {conn.status === "idle" && (
        <div style={{ fontSize: 12, color: "#6B6D76" }}>
          Al conectar, todo lo que llegue del LIVE se guarda además en un archivo aparte para analizarlo después.
        </div>
      )}
    </div>
  );
}
