import type { TiktokConnectionState } from "@streamtok/shared";
import { useState } from "react";
import type { ViewId } from "../App";
import { useTiktokConnection } from "../lib/use-tiktok-connection";
import type { SidecarClient } from "../lib/ws-client";

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

const STATUS: Record<TiktokConnectionState["status"], { color: string; label: string }> = {
  idle: { color: "#5B5D66", label: "Desconectado" },
  connecting: { color: "#F5A524", label: "Conectando…" },
  connected: { color: "#34D399", label: "Conectado" },
  error: { color: "#E5484D", label: "Desconectado" },
};

export function Sidebar({
  view,
  client,
  onNavigate,
}: {
  view: ViewId;
  client: SidecarClient | null;
  onNavigate: (v: ViewId) => void;
}) {
  const { conn, account: remembered } = useTiktokConnection(client);
  // Mientras hay conexión manda lo que reporta el sidecar; si no, la última cuenta recordada.
  const username = conn.username ?? remembered?.username;
  const nickname = conn.nickname ?? (conn.username ? undefined : remembered?.nickname);
  const avatarUrl = conn.avatarUrl ?? (conn.username ? undefined : remembered?.avatarUrl);
  const status = STATUS[conn.status];
  const displayName = username ? `@${username}` : "Sin cuenta";
  // Si la foto falla (URL vencida), se recuerda cuál falló para volver a la inicial.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const showPhoto = !!avatarUrl && failedAvatar !== avatarUrl;

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
        height: "100vh",
        overflowY: "auto",
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

      {/* cuenta de TikTok + estado de la conexión; lleva a Inicio para conectar */}
      <button
        type="button"
        onClick={() => onNavigate("inicio")}
        title={conn.status === "connected" ? "Conectado al LIVE" : "Ir a Inicio para conectar"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          textAlign: "left",
          padding: "10px 12px",
          borderRadius: 14,
          background: "#17181D",
          border: "1px solid #2A2C33",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
          {showPhoto ? (
            <img
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFailedAvatar(avatarUrl ?? null)}
              style={{ width: 40, height: 40, borderRadius: 11, objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                background: username ? ACCENT : "#23252C",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {(username ?? nickname)?.charAt(0).toUpperCase() ?? "?"}
            </div>
          )}
          <span
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: status.color,
              border: "2px solid #17181D",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            title={nickname}
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: username ? "#F4F4F5" : "#9A9CA5",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </span>
          <span style={{ fontSize: 11.5, color: status.color === "#34D399" ? status.color : "#9A9CA5" }}>
            {status.label}
          </span>
        </div>
      </button>

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
