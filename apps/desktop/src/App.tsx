import type { ModAckPayload, ModHelloPayload } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { ActionsPanel } from "./components/ActionsPanel";
import { InstallModButton } from "./components/InstallModButton";
import { MappingRulesPanel } from "./components/MappingRulesPanel";
import { ModLog } from "./components/ModLog";
import { SidecarClient } from "./lib/ws-client";

export function App() {
  const [catalog, setCatalog] = useState<ModHelloPayload | null>(null);
  const [ackLog, setAckLog] = useState<ModAckPayload[]>([]);
  const [modConnected, setModConnected] = useState(false);
  const [client, setClient] = useState<SidecarClient | null>(null);

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
        minHeight: "100vh",
        background: "#0E0F12",
        color: "#F4F4F5",
        fontFamily: "'Manrope', sans-serif",
        padding: 32,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 24, height: 24, borderRadius: 7, background: "#E23A57" }} />
        <span style={{ fontSize: 18, fontWeight: 700 }}>StreamTok</span>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontFamily: "'Space Grotesk', sans-serif" }}>
            Mods · GTA V Chaos Mod
          </h1>
          <ActionsPanel catalog={catalog} />
          <h2 style={{ margin: "0 0 -8px", fontSize: 14, color: "#C4C5CC" }}>Reglas de mapeo</h2>
          <MappingRulesPanel client={client} catalog={catalog} />
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
        </div>
      </div>
    </div>
  );
}
