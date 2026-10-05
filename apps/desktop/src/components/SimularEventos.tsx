import { useEffect, useState } from "react";
import type { GiftCatalogEntry, GiftCatalogMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { GiftPicker } from "./GiftPicker";

const ACCENT = "#E23A57";

/** Identidad con la que salen los eventos simulados (no hay cuenta real conectada). */
const TEST_USER = "StreamTok_Test";

/** Tope de likes por click, para no inundar el motor con un número sin querer. */
const MAX_LIKES = 500;

/** Cuenta de TikTok conectada, para mostrarla arriba del panel. */
export interface ConnectedAccount {
  name: string;
  handle: string;
}

/**
 * Panel "Simular Eventos": una fila por tipo de evento, con su propio botón,
 * igual que el panel de Interactive. Envía `live-event` por el canal WS del
 * sidecar (el mismo motor que procesa los eventos reales del LIVE).
 *
 * - Share / Follow / Suscripción / Unirse son generales (no llevan datos).
 * - Likes: manda N eventos `like` (el motor cuenta cada `like` como +1 para
 *   el umbral "cada N likes").
 * - Chat: manda el texto tal cual (para probar comandos "!palabra").
 * - Regalo: sale del catálogo persistido (canal WS `gift-catalog`, issue #35),
 *   disponible sin estar en vivo, con el costo y el ID reales del regalo.
 * - Emote y niveles (Fan/Donor) quedan deshabilitados: no hay catálogo de
 *   emotes ni un evento de nivel en el contrato (`live-event.ts`).
 *
 * `account` es la cuenta conectada en Inicio; hoy esa conexión no tiene
 * backend, así que normalmente llega `null` y se muestra "Sin cuenta
 * conectada".
 */
export function SimularEventos({
  client,
  account = null,
}: {
  client: SidecarClient | null;
  account?: ConnectedAccount | null;
}) {
  const [gifts, setGifts] = useState<GiftCatalogEntry[]>([]);
  const [gift, setGift] = useState("");
  const [likes, setLikes] = useState(20);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "gift-catalog") return;
      const msg = evt.payload as GiftCatalogMessage;
      if (msg.kind === "state") {
        setGifts(msg.gifts);
        setGift((current) =>
          current && msg.gifts.some((g) => g.name === current) ? current : (msg.gifts[0]?.name ?? ""),
        );
      }
    });
    // Snapshot bajo demanda: si este panel se monta después de la conexión
    // inicial, pide el estado actual (no lo recibió en `client-connected`).
    client.send("gift-catalog", { kind: "get-state" });
    return off;
  }, [client]);

  function send(event: string, extra: Record<string, unknown> = {}) {
    client?.send("live-event", {
      event,
      username: account?.handle ?? TEST_USER,
      nickname: account?.name ?? TEST_USER,
      repeatEnd: true,
      timestamp: Date.now(),
      ...extra,
    });
  }

  function simulateLikes() {
    const n = Math.min(MAX_LIKES, Math.max(1, Math.floor(likes) || 1));
    for (let i = 0; i < n; i++) send("like");
  }

  function simulateChat() {
    const text = comment.trim();
    if (!text) return;
    send("comment", { text });
  }

  function simulateGift() {
    const selected = gifts.find((g) => g.name === gift);
    if (!selected) return;
    // Un regalo simulado lleva el costo y el ID reales del catálogo (igual
    // que uno en vivo con repeatCount 1), para que los eventos de "regalo
    // específico" (por ID) y de "valor mínimo de monedas" se evalúen bien.
    const numericId = selected.id !== undefined && /^\d+$/.test(selected.id) ? Number(selected.id) : undefined;
    send("gift", { giftName: selected.name, giftId: numericId, coins: selected.cost });
  }

  const canSend = client !== null;

  return (
    <div
      style={{
        flex: 1.3,
        padding: 22,
        background: "#17181D",
        border: "1px solid #2A2C33",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: "0.06em" }}>
          PROBAR
        </span>
        <h2 style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          Simular Eventos
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#9A9CA5" }}>
          Dispara un evento de prueba solo para este juego, sin ir en vivo.
        </p>
      </div>

      {/* cuenta */}
      <div style={accountBoxStyle}>
        <div style={avatarStyle}>{account ? account.name.slice(0, 1).toUpperCase() : "?"}</div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: account ? "#F4F4F5" : "#9A9CA5" }}>
            {account ? account.name : "Sin cuenta conectada"}
          </span>
          <span style={{ fontSize: 11.5, color: "#5B5D66" }}>
            {account ? account.handle : `Los eventos salen como ${TEST_USER}`}
          </span>
        </div>
      </div>

      {/* pestaña de plataforma (por ahora solo TikTok) */}
      <div style={{ borderBottom: "1px solid #2A2C33" }}>
        <span style={tabStyle}>TikTok</span>
      </div>

      {/* eventos generales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <SimButton label="Share" onClick={() => send("share")} disabled={!canSend} />
        <SimButton label="Follow" onClick={() => send("follow")} disabled={!canSend} />
        <SimButton label="Suscripción" onClick={() => send("subscribe")} disabled={!canSend} />
        <SimButton label="Unirse" onClick={() => send("join")} disabled={!canSend} />
      </div>

      {/* likes */}
      <Row>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <input
            type="number"
            min={1}
            max={MAX_LIKES}
            value={likes}
            onChange={(e) => setLikes(Number(e.target.value))}
            style={{ ...inputStyle, paddingRight: 52 }}
          />
          <span style={inputSuffixStyle}>Likes</span>
        </div>
        <ActionButton label="Simular Likes" onClick={simulateLikes} disabled={!canSend} />
      </Row>

      {/* chat */}
      <Row>
        <input
          type="text"
          value={comment}
          placeholder="Ingresar comentario…"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") simulateChat();
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
        <ActionButton label="Simular Chat" onClick={simulateChat} disabled={!canSend || !comment.trim()} />
      </Row>

      {/* regalo */}
      <Row>
        {gifts.length === 0 ? (
          <div style={{ ...inputStyle, flex: 1, display: "flex", alignItems: "center", color: "#5B5D66" }}>
            Sin catálogo de regalos todavía
          </div>
        ) : (
          <GiftPicker value={gift} gifts={gifts} onSelect={setGift} />
        )}
        <ActionButton label="Simular Gift" onClick={simulateGift} disabled={!canSend || !gift} primary />
      </Row>

      {/* emote (próximamente: no hay catálogo de emotes) */}
      <Row>
        <div
          title="Los emotes se conocen solo desde eventos reales de un LIVE; todavía no hay catálogo."
          style={{ ...inputStyle, flex: 1, display: "flex", alignItems: "center", color: "#5B5D66", opacity: 0.6 }}
        >
          Elige un emote
        </div>
        <ActionButton label="Simular Emote" disabled />
      </Row>

      {/* niveles (próximamente: el contrato no tiene evento de nivel) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5B5D66", letterSpacing: "0.08em" }}>
          LEVEL UP · PRÓXIMAMENTE
        </span>
        <Row>
          <div style={{ position: "relative", flex: 1, minWidth: 0, opacity: 0.6 }}>
            <input type="number" disabled value={1} readOnly style={{ ...inputStyle, paddingRight: 70 }} />
            <span style={inputSuffixStyle}>Anterior</span>
          </div>
          <ActionButton label="Simular Fan Lvl" disabled />
        </Row>
        <Row>
          <div style={{ position: "relative", flex: 1, minWidth: 0, opacity: 0.6 }}>
            <input type="number" disabled value={2} readOnly style={{ ...inputStyle, paddingRight: 70 }} />
            <span style={inputSuffixStyle}>Nuevo</span>
          </div>
          <ActionButton label="Simular Donor Lvl" disabled />
        </Row>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>;
}

function SimButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0E0F12",
        border: "1px solid #2A2C33",
        color: "#C4C5CC",
        borderRadius: 8,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

/** Botón de la columna derecha (ancho fijo para que todas las filas alineen). */
function ActionButton({
  label,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 132,
        flexShrink: 0,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: primary && !disabled ? ACCENT : "#0E0F12",
        border: primary && !disabled ? "none" : "1px solid #2A2C33",
        color: primary && !disabled ? "#FFFFFF" : "#C4C5CC",
        borderRadius: 8,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

const accountBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 10,
};

const avatarStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "#2A2C33",
  color: "#9A9CA5",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  fontWeight: 700,
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 2px 8px",
  fontSize: 12.5,
  fontWeight: 700,
  color: "#F4F4F5",
  borderBottom: `2px solid ${ACCENT}`,
  marginBottom: -1,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  padding: "0 12px",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
  boxSizing: "border-box",
};

const inputSuffixStyle: React.CSSProperties = {
  position: "absolute",
  right: 12,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 11.5,
  color: "#5B5D66",
  pointerEvents: "none",
};
