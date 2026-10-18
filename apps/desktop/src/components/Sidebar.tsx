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
 * Lo que aún no existe se ve deshabilitado con etiqueta "Próximamente".
 * "Overlays" es una sección que se abre y se cierra; "Metas" tiene sub-items.
 */
const NAV_TOP: NavItem[] = [
  { id: "inicio", label: "Inicio", enabled: true },
  { id: "live", label: "Live", enabled: false },
];

/** Categorías de overlays (ver streamtok-overlays-cobertura.md). */
const OVERLAY_ITEMS: NavItem[] = [
  { id: "temporizador", label: "Temporizador", enabled: true },
  { id: "wins", label: "Wins", enabled: true },
  { id: "metas", label: "Metas", enabled: true },
  { id: "tops", label: "Tops y MVP", enabled: false },
  { id: "duelos", label: "Batallas y duelos", enabled: true },
  { id: "juegos-interactivos", label: "Juegos de stream", enabled: false },
  { id: "alertas", label: "Alertas y efectos", enabled: true },
  { id: "chat-feed", label: "Chat y feed", enabled: false },
];

/** Sub-items de Metas; el id es el de la meta (o "rotativa" / "personalizadas"). */
export const META_NAV: { id: string; label: string }[] = [
  { id: "rotativa", label: "Rotativas" },
  { id: "likes", label: "Likes" },
  { id: "seguidores", label: "Seguidores" },
  { id: "compartidos", label: "Compartidos" },
  { id: "monedas", label: "Monedas" },
  { id: "superfans", label: "Super Fans" },
  { id: "regalos", label: "Regalos" },
  { id: "espectadores", label: "Espectadores" },
  { id: "personalizadas", label: "Personalizadas" },
];

/** Sub-items de Alertas y efectos → Subida de nivel; el id es el de la alerta. */
export const ALERT_NAV: { id: string; label: string }[] = [
  { id: "comunidad", label: "Comunidad (Quiéreme)" },
  { id: "donador", label: "Nivel de donador" },
  { id: "todas", label: "Todas (rotativo)" },
];

/** Sub-items de Batallas y duelos; el id es el del duelo. */
export const DUEL_NAV: { id: string; label: string }[] = [
  { id: "regalo-vs-regalo", label: "Regalo vs Regalo" },
  { id: "equipos", label: "Azul vs Rojo (equipos)" },
  { id: "top", label: "Top 1 vs Top 2" },
];

const NAV_BOTTOM: NavItem[] = [
  { id: "simulador", label: "Simulador", enabled: false },
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
  metaSel,
  onSelectMeta,
  alertSel,
  onSelectAlert,
  duelSel,
  onSelectDuel,
}: {
  view: ViewId;
  client: SidecarClient | null;
  onNavigate: (v: ViewId) => void;
  metaSel: string;
  onSelectMeta: (id: string) => void;
  alertSel: string;
  onSelectAlert: (id: string) => void;
  duelSel: string;
  onSelectDuel: (id: string) => void;
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
  const [overlaysOpen, setOverlaysOpen] = useState(true);
  const [metasOpen, setMetasOpen] = useState(true);
  const [alertasOpen, setAlertasOpen] = useState(true);
  const [duelosOpen, setDuelosOpen] = useState(true);
  const showPhoto = !!avatarUrl && failedAvatar !== avatarUrl;

  return (
    <aside
      style={{
        width: 292,
        flexShrink: 0,
        boxSizing: "border-box",
        padding: "28px 14px",
        borderRight: "1px solid #22242B",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
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
        {NAV_TOP.map((item) => (
          <NavButton key={item.id} label={item.label} enabled={item.enabled} active={item.enabled && view === item.id} onClick={() => onNavigate(item.id as ViewId)} />
        ))}

        <NavButton
          label="Overlays"
          enabled
          active={view === "overlays"}
          chevron={overlaysOpen ? "▾" : "▸"}
          onClick={() => {
            setOverlaysOpen((v) => !v);
            onNavigate("overlays");
          }}
        />
        {overlaysOpen &&
          OVERLAY_ITEMS.map((item) => (
            <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <NavButton
                label={item.label}
                enabled={item.enabled}
                indent={1}
                active={item.enabled && view === item.id}
                chevron={
                  item.id === "metas"
                    ? metasOpen ? "▾" : "▸"
                    : item.id === "alertas"
                      ? alertasOpen ? "▾" : "▸"
                      : item.id === "duelos"
                        ? duelosOpen ? "▾" : "▸"
                        : undefined
                }
                onClick={() => {
                  if (item.id === "metas") {
                    setMetasOpen((v) => (view === "metas" ? !v : true));
                    onNavigate("metas");
                  } else if (item.id === "alertas") {
                    setAlertasOpen((v) => (view === "alertas" ? !v : true));
                    onNavigate("alertas");
                  } else if (item.id === "duelos") {
                    setDuelosOpen((v) => (view === "duelos" ? !v : true));
                    onNavigate("duelos");
                  } else onNavigate(item.id as ViewId);
                }}
              />
              {item.id === "metas" &&
                metasOpen &&
                META_NAV.map((m) => (
                  <NavButton
                    key={m.id}
                    label={m.label}
                    enabled
                    indent={2}
                    active={view === "metas" && metaSel === m.id}
                    onClick={() => onSelectMeta(m.id)}
                  />
                ))}
              {item.id === "alertas" &&
                alertasOpen &&
                ALERT_NAV.map((a) => (
                  <NavButton
                    key={a.id}
                    label={a.label}
                    enabled
                    indent={2}
                    active={view === "alertas" && alertSel === a.id}
                    onClick={() => onSelectAlert(a.id)}
                  />
                ))}
              {item.id === "duelos" &&
                duelosOpen &&
                DUEL_NAV.map((d) => (
                  <NavButton
                    key={d.id}
                    label={d.label}
                    enabled
                    indent={2}
                    active={view === "duelos" && duelSel === d.id}
                    onClick={() => onSelectDuel(d.id)}
                  />
                ))}
            </div>
          ))}

        {NAV_BOTTOM.map((item) => (
          <NavButton
            key={item.id}
            label={item.label}
            enabled={item.enabled}
            active={
              item.enabled &&
              (view === item.id || ((view === "juego-detalle" || view === "gestionar-perfiles") && item.id === "juegos"))
            }
            onClick={() => onNavigate(item.id as ViewId)}
          />
        ))}
      </div>
    </aside>
  );
}

function NavButton({
  label,
  enabled,
  active,
  onClick,
  indent = 0,
  chevron,
}: {
  label: string;
  enabled: boolean;
  active: boolean;
  onClick: () => void;
  indent?: 0 | 1 | 2;
  chevron?: string;
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        padding: indent === 2 ? "6px 12px 6px 44px" : indent === 1 ? "8px 12px 8px 28px" : "10px 12px",
        borderRadius: 10,
        background: active ? "#1E2027" : "transparent",
        border: "none",
        color: active ? "#FFFFFF" : "#9A9CA5",
        fontSize: indent === 2 ? 12.5 : indent === 1 ? 13.5 : 14,
        fontWeight: active ? 700 : 500,
        cursor: enabled ? "pointer" : "default",
      }}
    >
      {indent < 2 && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: active ? ACCENT : "#3A3C44",
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{label}</span>
      {chevron && <span style={{ fontSize: 10, flexShrink: 0 }}>{chevron}</span>}
      {!enabled && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: "#9A9CA5",
            background: "#23252C",
            padding: "2px 6px",
            borderRadius: 4,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          Próximamente
        </span>
      )}
    </button>
  );
}
