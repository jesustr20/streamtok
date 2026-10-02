import type { ModAckPayload, ModHelloPayload } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { AccionesEventosSection } from "./components/AccionesEventosSection";
import { ActionsPanel } from "./components/ActionsPanel";
import { EventQueuePanel } from "./components/EventQueuePanel";
import { InstallModButton } from "./components/InstallModButton";
import { ModLog } from "./components/ModLog";
import { ProfilesPanel } from "./components/ProfilesPanel";
import { Sidebar } from "./components/Sidebar";
import { SidecarClient } from "./lib/ws-client";

export type ViewId = "inicio" | "juegos";

function InicioView({ modConnected, onGoJuegos }: { modConnected: boolean; onGoJuegos: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontFamily: "'Space Grotesk', sans-serif" }}>
        Inicio
      </h1>
      <div
        style={{
          padding: 20,
          background: "#14151A",
          border: "1px solid #2A2C33",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 13.5, color: "#C4C5CC" }}>
          Conecta tu LIVE de TikTok y traduce las interacciones de tu audiencia en
          acciones dentro de tus mods de juegos.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: modConnected ? "#34D399" : "#3A3C44",
            }}
          />
          {modConnected ? "Mod GTA V conectado" : "Mod GTA V desconectado"}
        </div>
        <button
          type="button"
          onClick={onGoJuegos}
          style={{
            alignSelf: "flex-start",
            padding: "8px 16px",
            background: "#E23A57",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Ir a Juegos
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [catalog, setCatalog] = useState<ModHelloPayload | null>(null);
  const [ackLog, setAckLog] = useState<ModAckPayload[]>([]);
  const [modConnected, setModConnected] = useState(false);
  const [client, setClient] = useState<SidecarClient | null>(null);
  const [view, setView] = useState<ViewId>("juegos");

  useEffect(() => {
    const c = new SidecarClient();
    setClient(c);
    // El sidecar reenvía "mod-hello"/"mod-ack" tal cual el mod los manda —
    // sin canales aparte inventados para la UI (ver mod-bridge.ts).
    const off = c.on((evt) => {
      if (evt.channel === "mod-hello") {
        setCatalog(evt.payload as ModHelloPayload);
        setModConnected(true);
      }
      if (evt.channel === "mod-ack") {
        setAckLog((prev) => [...prev.slice(-99), evt.payload as ModAckPayload]);
      }
    });
    return () => {
      off();
      c.destroy();
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0E0F12",
        color: "#F4F4F5",
        fontFamily: "'Manrope', sans-serif",
      }}
    >
      <Sidebar view={view} onNavigate={setView} />

      <main
        style={{
          flex: 1,
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 28,
          boxSizing: "border-box",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12.5,
              color: modConnected ? "#34D399" : "#9A9CA5",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: modConnected ? "#34D399" : "#3A3C44",
              }}
            />
            {modConnected ? "Mod GTA V conectado" : "Mod GTA V desconectado"}
          </span>
        </div>

        {view === "inicio" ? (
          <InicioView modConnected={modConnected} onGoJuegos={() => setView("juegos")} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontFamily: "'Space Grotesk', sans-serif" }}>
                Mods · GTA V Chaos Mod
              </h1>
              <ActionsPanel catalog={catalog} client={client} />
              <ProfilesPanel client={client} />
              <AccionesEventosSection catalog={catalog} client={client} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <h2 style={{ margin: "0 0 10px", fontSize: 14, color: "#C4C5CC" }}>Instalación</h2>
                <InstallModButton />
              </div>
              <div>
                <h2 style={{ margin: "0 0 10px", fontSize: 14, color: "#C4C5CC" }}>Log de mod-ack</h2>
                <ModLog entries={ackLog} />
              </div>
              <div>
                <h2 style={{ margin: "0 0 10px", fontSize: 14, color: "#C4C5CC" }}>Eventos y Cola</h2>
                <EventQueuePanel client={client} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
