import { useEffect, useRef, useState } from "react";
import type {
  EventLogEntry,
  EventLogMessage,
  EventosMessage,
  GiftCatalogEntry,
  GiftCatalogMessage,
} from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { GiftPicker } from "./GiftPicker";

const ACCENT = "#E23A57";

/** Identidad con la que salen los eventos simulados (no hay cuenta real conectada). */
const TEST_USER = "StreamTok_Test";

/** Tope de likes por click, para no inundar el motor con un número sin querer. */
const MAX_LIKES = 500;

/** Cuántas líneas de resultado se muestran como máximo por prueba. */
const MAX_RESULTS = 4;

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
 * - Likes: manda un evento `like` con `likeCount` = N taps (como TikTok, que
 *   agrupa varios taps por mensaje); el motor los acumula por usuario.
 * - Chat: manda el texto tal cual (para probar comandos "!palabra").
 * - Regalo: sale del catálogo persistido (canal WS `gift-catalog`, issue #35),
 *   disponible sin estar en vivo, con el costo y el ID reales del regalo.
 * - Roles del usuario de prueba (Seguidor / Suscriptor / Moderador): se
 *   agregan a TODO evento simulado, para poder probar Eventos cuyo "¿Quién
 *   puede desencadenar?" no es "Todos". (Donante principal sale solo: el motor
 *   acumula las monedas de los regalos simulados.)
 * - Emote / Sticker: el id se escribe o se elige de los que ya usan tus
 *   Eventos (no hay catálogo de emotes).
 * - Debajo se muestra el resultado de la última prueba (qué evento/acción se
 *   disparó o por qué no), tomado del canal `event-log` del sidecar.
 * - Level up (Fan / Donor): manda `fanLevelUp` / `donorLevelUp` con el nivel
 *   anterior y el nuevo (ADR 0007), igual que el sidecar al detectar una subida
 *   real. Solo se puede simular una subida (nuevo > anterior).
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
  const [roles, setRoles] = useState({ isFollower: false, isSubscriber: false, isModerator: false });
  const [emoteId, setEmoteId] = useState("");
  const [emoteScene, setEmoteScene] = useState<"subscriber" | "fanClub">("subscriber");
  const [knownEmotes, setKnownEmotes] = useState<{ subscriber: string[]; fanClub: string[] }>({
    subscriber: [],
    fanClub: [],
  });
  const [fanLevels, setFanLevels] = useState({ previous: 1, next: 2 });
  const [donorLevels, setDonorLevels] = useState({ previous: 1, next: 2 });
  const [results, setResults] = useState<EventLogEntry[]>([]);
  // Solo se muestran las entradas que llegan después de pulsar un botón.
  const watching = useRef(false);

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

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel === "eventos") {
        const msg = evt.payload as EventosMessage;
        if (msg.kind !== "update") return;
        const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
        setKnownEmotes({
          subscriber: uniq(msg.eventos.filter((e) => e.porque === "emoteSuscriptor").map((e) => e.emoteId)),
          fanClub: uniq(msg.eventos.filter((e) => e.porque === "stickerFanClub").map((e) => e.stickerId)),
        });
      } else if (evt.channel === "event-log") {
        const msg = evt.payload as EventLogMessage;
        if (msg.kind !== "append" || !watching.current) return;
        setResults((prev) => [...prev, msg.entry].slice(-MAX_RESULTS));
      }
    });
    return off;
  }, [client]);

  /** Cada prueba (click) empieza un resultado nuevo. */
  function begin() {
    watching.current = true;
    setResults([]);
  }

  function send(event: string, extra: Record<string, unknown> = {}) {
    client?.send("live-event", {
      event,
      username: account?.handle ?? TEST_USER,
      nickname: account?.name ?? TEST_USER,
      ...roles,
      repeatEnd: true,
      timestamp: Date.now(),
      ...extra,
    });
  }

  function simulateLikes() {
    begin();
    const n = Math.min(MAX_LIKES, Math.max(1, Math.floor(likes) || 1));
    send("like", { likeCount: n });
  }

  function simulateChat() {
    const text = comment.trim();
    if (!text) return;
    begin();
    send("comment", { text });
  }

  function simulateGift() {
    const selected = gifts.find((g) => g.name === gift);
    if (!selected) return;
    begin();
    // Un regalo simulado lleva el costo y el ID reales del catálogo (igual
    // que uno en vivo con repeatCount 1), para que los eventos de "regalo
    // específico" (por ID) y de "valor mínimo de monedas" se evalúen bien.
    const numericId = selected.id !== undefined && /^\d+$/.test(selected.id) ? Number(selected.id) : undefined;
    send("gift", { giftName: selected.name, giftId: numericId, coins: selected.cost });
  }

  function simulateEmote() {
    const id = emoteId.trim();
    if (!id) return;
    begin();
    send("emote", { emoteId: id, emoteScene });
  }

  function simulateLevelUp(kind: "fanLevelUp" | "donorLevelUp") {
    const lv = kind === "fanLevelUp" ? fanLevels : donorLevels;
    const previousLevel = Math.max(0, Math.floor(lv.previous) || 0);
    const newLevel = Math.max(0, Math.floor(lv.next) || 0);
    begin();
    send(kind, {
      previousLevel,
      newLevel,
      ...(kind === "fanLevelUp" ? { fanLevel: newLevel } : { userLevel: newLevel }),
    });
  }

  const canSend = client !== null;
  const suggestions = knownEmotes[emoteScene];
  const lastResult = results[results.length - 1];

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

      {/* roles del usuario de prueba */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, color: "#9A9CA5", marginRight: 2 }}>El usuario de prueba es:</span>
        {(
          [
            ["isFollower", "Seguidor"],
            ["isSubscriber", "Suscriptor"],
            ["isModerator", "Moderador"],
          ] as const
        ).map(([key, label]) => (
          <RoleChip
            key={key}
            label={label}
            active={roles[key]}
            onClick={() => setRoles((r) => ({ ...r, [key]: !r[key] }))}
          />
        ))}
      </div>

      {/* pestaña de plataforma (por ahora solo TikTok) */}
      <div style={{ borderBottom: "1px solid #2A2C33" }}>
        <span style={tabStyle}>TikTok</span>
      </div>

      {/* eventos generales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        <SimButton label="Share" onClick={() => { begin(); send("share"); }} disabled={!canSend} />
        <SimButton label="Follow" onClick={() => { begin(); send("follow"); }} disabled={!canSend} />
        <SimButton label="Suscripción" onClick={() => { begin(); send("subscribe"); }} disabled={!canSend} />
        <SimButton label="Unirse" onClick={() => { begin(); send("join"); }} disabled={!canSend} />
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

      {/* emote / sticker */}
      <Row>
        <select
          value={emoteScene}
          onChange={(e) => setEmoteScene(e.target.value as "subscriber" | "fanClub")}
          style={{ ...inputStyle, width: 176, flexShrink: 0 }}
        >
          <option value="subscriber">Emote de suscriptor</option>
          <option value="fanClub">Sticker club de fans</option>
        </select>
        <input
          type="text"
          list="simular-emotes"
          value={emoteId}
          placeholder={emoteScene === "subscriber" ? "ID del emote…" : "ID del sticker…"}
          onChange={(e) => setEmoteId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") simulateEmote();
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
        <datalist id="simular-emotes">
          {suggestions.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <ActionButton label="Simular Emote" onClick={simulateEmote} disabled={!canSend || !emoteId.trim()} />
      </Row>

      {/* resultado de la última prueba */}
      <div style={resultBoxStyle}>
        {lastResult ? (
          results.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ color: r.status === "fired" ? "#34D399" : "#F5A524", fontWeight: 700 }}>
                {r.status === "fired" ? "✓ Disparó" : "• No disparó"}
              </span>
              <span style={{ color: "#C4C5CC" }}>{r.message}</span>
            </div>
          ))
        ) : (
          <span style={{ color: "#5B5D66" }}>
            Aquí verás qué evento y acción se disparó con tu última prueba (o por qué no).
          </span>
        )}
      </div>

      {/* niveles: Anterior → Nuevo (el motor los recibe como fanLevelUp / donorLevelUp) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5B5D66", letterSpacing: "0.08em" }}>
          LEVEL UP
        </span>
        {(
          [
            ["fanLevelUp", "Simular Fan Lvl", fanLevels, setFanLevels],
            ["donorLevelUp", "Simular Donor Lvl", donorLevels, setDonorLevels],
          ] as const
        ).map(([kind, label, lv, setLv]) => (
          <Row key={kind}>
            <LevelInput value={lv.previous} suffix="Anterior" onChange={(n) => setLv({ ...lv, previous: n })} />
            <LevelInput value={lv.next} suffix="Nuevo" onChange={(n) => setLv({ ...lv, next: n })} />
            <ActionButton
              label={label}
              onClick={() => simulateLevelUp(kind)}
              disabled={!canSend || lv.next <= lv.previous}
            />
          </Row>
        ))}
      </div>
    </div>
  );
}

function LevelInput({
  value,
  suffix,
  onChange,
}: {
  value: number;
  suffix: string;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        type="number"
        min={0}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        style={{ ...inputStyle, paddingRight: 70 }}
      />
      <span style={inputSuffixStyle}>{suffix}</span>
    </div>
  );
}

function RoleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        height: 26,
        padding: "0 11px",
        borderRadius: 13,
        fontSize: 11.5,
        fontWeight: 700,
        cursor: "pointer",
        background: active ? ACCENT : "#0E0F12",
        color: active ? "#FFFFFF" : "#9A9CA5",
        border: active ? "1px solid transparent" : "1px solid #2A2C33",
      }}
    >
      {label}
    </button>
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

const resultBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 14px",
  minHeight: 38,
  background: "#0E0F12",
  border: "1px dashed #2A2C33",
  borderRadius: 10,
  fontSize: 12,
  boxSizing: "border-box",
};

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
