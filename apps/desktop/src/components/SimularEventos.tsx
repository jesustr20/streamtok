import { useEffect, useState } from "react";
import type { GiftCatalogMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";

const ACCENT = "#E23A57";

const SIM_BOTONES = [
  { label: "Simular Share", event: "share" },
  { label: "Simular Follow", event: "follow" },
  { label: "Simular Suscripción", event: "subscribe" },
  { label: "Simular Likes", event: "like" },
  { label: "Simular Chat", event: "comment" },
  { label: "Simular Fan Lvl", event: "join" },
] as const;

/**
 * Panel "Simular Eventos" (ModDetalle.dc.html): usuario de prueba + grid de
 * botones de simulación + selector de regalo. Envía `live-event` por el canal
 * WS del sidecar (el mismo motor que procesa los eventos reales del LIVE).
 *
 * El selector de regalo sale del catálogo persistido (canal WS
 * `gift-catalog`, issue #35) — disponible desde el primer arranque (semilla
 * estática) sin necesitar estar en vivo, y se actualiza solo si llega un
 * regalo nuevo/confirmado mientras el panel está abierto.
 */
export function SimularEventos({ client }: { client: SidecarClient | null }) {
  const [testUser, setTestUser] = useState("StreamTok_Test");
  const [gifts, setGifts] = useState<string[]>([]);
  const [gift, setGift] = useState("");

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "gift-catalog") return;
      const msg = evt.payload as GiftCatalogMessage;
      if (msg.kind === "state") {
        const names = msg.gifts.map((g) => g.name);
        setGifts(names);
        setGift((current) => (current && names.includes(current) ? current : (names[0] ?? "")));
      }
    });
    // Snapshot bajo demanda: si este panel se monta después de la conexión
    // inicial, pide el estado actual (no lo recibió en `client-connected`).
    client.send("gift-catalog", { kind: "get-state" });
    return off;
  }, [client]);

  function simulate(event: string, giftName?: string) {
    client?.send("live-event", {
      event,
      username: testUser,
      nickname: testUser,
      giftName,
      coins: giftName ? 1 : undefined,
      text: event === "comment" ? "!prueba" : undefined,
      repeatEnd: true,
      timestamp: Date.now(),
    });
  }

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

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>Usuario de prueba</label>
        <input
          type="text"
          value={testUser}
          onChange={(e) => setTestUser(e.target.value)}
          style={{
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
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {SIM_BOTONES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => simulate(s.event)}
            style={{
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0E0F12",
              border: "1px solid #2A2C33",
              color: "#C4C5CC",
              borderRadius: 8,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={gift}
          onChange={(e) => setGift(e.target.value)}
          style={{
            flex: 1,
            height: 36,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 8,
            color: "#F4F4F5",
            padding: "0 10px",
            fontSize: 12,
            outline: "none",
            fontFamily: "'Manrope', sans-serif",
            boxSizing: "border-box",
          }}
        >
          {gifts.length === 0 ? (
            <option value="">Sin catálogo de regalos todavía</option>
          ) : (
            gifts.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          disabled={!gift}
          onClick={() => simulate("gift", gift)}
          style={{
            padding: "0 14px",
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: ACCENT,
            color: "#FFFFFF",
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 700,
            whiteSpace: "nowrap",
            border: "none",
            cursor: "pointer",
          }}
        >
          ▶ Simular Gift
        </button>
      </div>
    </div>
  );
}
