import type { ModHelloPayload } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { InicioView } from "./components/InicioView";
import { ModDetalle } from "./components/ModDetalle";
import { ModsLibrary } from "./components/ModsLibrary";
import { Sidebar } from "./components/Sidebar";
import { SidecarClient } from "./lib/ws-client";

export type ViewId = "inicio" | "juegos" | "juego-detalle";

export function App() {
  const [catalog, setCatalog] = useState<ModHelloPayload | null>(null);
  const [client, setClient] = useState<SidecarClient | null>(null);
  const [view, setView] = useState<ViewId>("inicio");

  useEffect(() => {
    const c = new SidecarClient();
    setClient(c);
    // El sidecar reenvía "mod-hello" tal cual el mod lo manda — sin canales
    // aparte inventados para la UI (ver mod-bridge.ts).
    const off = c.on((evt) => {
      if (evt.channel === "mod-hello") {
        setCatalog(evt.payload as ModHelloPayload);
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
          padding: "32px 40px 60px",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          minWidth: 0,
        }}
      >
        {view === "inicio" && <InicioView onGoJuegos={() => setView("juegos")} />}
        {view === "juegos" && (
          <ModsLibrary catalog={catalog} onOpenMod={() => setView("juego-detalle")} />
        )}
        {view === "juego-detalle" && (
          <ModDetalle catalog={catalog} client={client} onBack={() => setView("juegos")} />
        )}
      </main>
    </div>
  );
}
