import { useEffect, useRef, useState } from "react";
import type { EventosMessage, ModHelloPayload } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { AccionesEventosSection } from "./AccionesEventosSection";
import { ConexionAcceso } from "./ConexionAcceso";
import { ConfigurarEventos } from "./ConfigurarEventos";
import { EventQueuePanel } from "./EventQueuePanel";
import { OverlaySection } from "./OverlaySection";
import { PerfilConfiguracion } from "./PerfilConfiguracion";
import { SimularEventos } from "./SimularEventos";

const ACCENT = "#E23A57";

const JUMPS = [
  { label: "⚙ Conexión y Acceso", ref: "conexion" },
  { label: "⚡ Acciones y Eventos", ref: "accioneseventos" },
  { label: "▶ Simular Eventos", ref: "simulador" },
  { label: "📡 Overlay", ref: "overlay" },
] as const;

type SectionRef = (typeof JUMPS)[number]["ref"];

/**
 * Vista de detalle del mod (ModDetalle.dc.html): header con tarjeta partida,
 * accesos rápidos, Conexión y Acceso, Perfil de configuración, Acciones y
 * Eventos, fila de 3 columnas (Simular/Configurar/Eventos y Cola) y Overlay.
 */
export function ModDetalle({
  catalog,
  catalogSource,
  client,
  onBack,
  onGestionarPerfiles,
}: {
  catalog: ModHelloPayload | null;
  /** "live" = mod-hello real por WS ahora mismo; "cached" = catálogo offline
   * (disco/último Release), sin el mod abierto. Ver ADR 0006. */
  catalogSource?: "live" | "cached" | null;
  client: SidecarClient | null;
  onBack: () => void;
  onGestionarPerfiles: () => void;
}) {
  const [eventosCount, setEventosCount] = useState(0);

  const refs: Record<SectionRef, React.RefObject<HTMLDivElement>> = {
    conexion: useRef<HTMLDivElement>(null),
    accioneseventos: useRef<HTMLDivElement>(null),
    simulador: useRef<HTMLDivElement>(null),
    overlay: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel === "eventos") {
        const msg = evt.payload as EventosMessage;
        if (msg.kind === "update") setEventosCount(msg.eventos.length);
      }
    });
    return off;
  }, [client]);

  const comandos = catalog?.actions.length ?? 0;

  function jumpTo(ref: SectionRef) {
    refs[ref].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          fontSize: 12.5,
          color: "#9A9CA5",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          alignSelf: "flex-start",
        }}
      >
        ‹ Volver a Mods
      </button>

      {/* header: tarjeta partida */}
      <div style={{ display: "flex", borderRadius: 16, overflow: "hidden", border: "1px solid #2A2C33" }}>
        <div
          style={{
            flexGrow: 1,
            padding: "26px 28px",
            background: "#17181D",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0,
          }}
        >
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#5B7CFA", letterSpacing: "0.06em" }}>
              MODS · GTA V
            </span>
            <h1 style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
              GTA V Chaos Mod
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#9A9CA5", maxWidth: 480, lineHeight: 1.5 }}>
              Convierte los regalos y comentarios de tu LIVE en acciones dentro del juego.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                background: "#0E0F12",
                border: "1px solid #2A2C33",
                fontSize: 12,
                color: "#C4C5CC",
              }}
            >
              ⚡ {comandos} {comandos === 1 ? "comando disponible" : "comandos disponibles"}
            </div>
            {catalogSource === "cached" && (
              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  background: "#0E0F12",
                  border: "1px solid #2A2C33",
                  fontSize: 12,
                  color: "#9A9CA5",
                }}
                title="Catálogo offline: se actualiza solo al conectar el mod o al salir una Release nueva."
              >
                ⟲ catálogo offline v{catalog?.version}
              </div>
            )}
            <div
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                background: "#0E0F12",
                border: "1px solid #2A2C33",
                fontSize: 12,
                color: "#C4C5CC",
              }}
            >
              ◔ {eventosCount} {eventosCount === 1 ? "evento configurado" : "eventos configurados"}
            </div>
          </div>
        </div>
        <div
          style={{
            width: 260,
            flexShrink: 0,
            background: "#5B7CFA",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          <span
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "#FFFFFF",
            }}
          >
            GTA V
          </span>
          <div
            style={{
              padding: "0 22px",
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: ACCENT,
              color: "#FFFFFF",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            ▶ Jugar
          </div>
        </div>
      </div>

      {/* accesos rápidos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {JUMPS.map((j) => (
          <button
            key={j.ref}
            type="button"
            onClick={() => jumpTo(j.ref)}
            style={{
              padding: "14px 16px",
              background: "#17181D",
              border: "1px solid #2A2C33",
              borderRadius: 12,
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#C4C5CC" }}>{j.label}</span>
          </button>
        ))}
      </div>

      {/* Conexión y Acceso */}
      <div ref={refs.conexion}>
        <ConexionAcceso />
      </div>

      {/* Perfil de configuración */}
      <PerfilConfiguracion client={client} onGestionarPerfiles={onGestionarPerfiles} />

      {/* Acciones y Eventos */}
      <div ref={refs.accioneseventos}>
        <AccionesEventosSection catalog={catalog} client={client} />
      </div>

      {/* Simular + Configurar + Eventos y Cola */}
      <div ref={refs.simulador} style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <SimularEventos client={client} />
        <ConfigurarEventos />
        <EventQueuePanel client={client} />
      </div>

      {/* Overlay */}
      <div ref={refs.overlay} id="overlay">
        <OverlaySection />
      </div>
    </div>
  );
}
