import { ModHelloPayloadSchema, type ModHelloPayload } from "@streamtok/shared";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { GestionarPerfiles } from "./components/GestionarPerfiles";
import { InicioView } from "./components/InicioView";
import { ModDetalle } from "./components/ModDetalle";
import { ModsLibrary } from "./components/ModsLibrary";
import { Sidebar } from "./components/Sidebar";
import { SidecarClient } from "./lib/ws-client";

export type ViewId = "inicio" | "juegos" | "juego-detalle" | "gestionar-perfiles";

export function App() {
  const [catalog, setCatalog] = useState<ModHelloPayload | null>(null);
  // "live" = viene de un mod-hello real por WS ahora mismo; "cached" = del
  // catalog.json offline (disco/último Release), sin el mod abierto. Ver
  // ADR 0006 — el cache siempre es reemplazable, nunca fuente de verdad.
  const [catalogSource, setCatalogSource] = useState<"live" | "cached" | null>(null);
  const [client, setClient] = useState<SidecarClient | null>(null);
  const [view, setView] = useState<ViewId>("inicio");

  useEffect(() => {
    // Catálogo offline: se pide apenas arranca la app, independientemente
    // de si el mod está corriendo. Si el payload no calza con el schema del
    // contrato, se descarta en vez de mostrar algo corrupto (ADR 0006).
    (async () => {
      try {
        const raw = await invoke<string | null>("get_action_catalog");
        if (!raw) return;
        const parsed = ModHelloPayloadSchema.parse(JSON.parse(raw));
        setCatalog((current) => current ?? parsed);
        setCatalogSource((current) => current ?? "cached");
      } catch {
        // Sin red y sin cache previo, o JSON que no calza con el contrato:
        // seguimos sin catálogo hasta que conecte el mod en vivo.
      }
    })();
  }, []);

  useEffect(() => {
    const c = new SidecarClient();
    setClient(c);
    // El sidecar reenvía "mod-hello" tal cual el mod lo manda — sin canales
    // aparte inventados para la UI (ver mod-bridge.ts).
    const off = c.on((evt) => {
      if (evt.channel === "mod-hello") {
        const payload = evt.payload as ModHelloPayload;
        setCatalog(payload);
        setCatalogSource("live");
        // El mod-hello en vivo es la fuente más autoritativa que hay — pisa
        // el cache en disco sin esperar al próximo Release (ADR 0006).
        void invoke("cache_action_catalog", { catalogJson: JSON.stringify(payload) });
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
          <ModDetalle
            catalog={catalog}
            catalogSource={catalogSource}
            client={client}
            onBack={() => setView("juegos")}
            onGestionarPerfiles={() => setView("gestionar-perfiles")}
          />
        )}
        {view === "gestionar-perfiles" && (
          <GestionarPerfiles client={client} onBack={() => setView("juego-detalle")} />
        )}
      </main>
    </div>
  );
}
