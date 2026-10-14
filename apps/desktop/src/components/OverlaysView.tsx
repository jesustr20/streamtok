import { useState } from "react";
import { useOverlays } from "../lib/use-overlays";
import type { SidecarClient } from "../lib/ws-client";
import { ACCENT, Btn, DesignCard, UrlCard, cardStyle } from "./overlays-ui";

type Sub = "timer" | "wins";

const SUBS: { id: Sub; label: string; hint: string }[] = [
  { id: "timer", label: "Timer", hint: "Cuenta atrás que tus espectadores alargan" },
  { id: "wins", label: "Wins", hint: "Meta y conteo, p. ej. 2 / 6" },
];

/**
 * Sección "Overlays": lo que se ve en el stream. Por cada overlay, su enlace,
 * la lista de diseños, la vista previa y la personalización. El control y la
 * configuración de cada uno están en su propio módulo (Temporizador, Wins).
 */
export function OverlaysView({
  client,
  onOpenModule,
}: {
  client: SidecarClient | null;
  onOpenModule: (id: "temporizador" | "wins") => void;
}) {
  const [sub, setSub] = useState<Sub>("timer");
  const ov = useOverlays(client);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Overlays</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Elementos que se ven en tu stream. Pega el enlace como fuente en TikTok LIVE Studio u OBS.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {SUBS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            style={{
              ...cardStyle,
              cursor: "pointer",
              textAlign: "left",
              flex: 1,
              borderColor: sub === s.id ? ACCENT : "#2A2C33",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: "#9A9CA5", marginTop: 3 }}>{s.hint}</div>
          </button>
        ))}
      </div>

      {!ov.config ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : (
        <>
          {ov.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{ov.error}</div>}
          <UrlCard kind={sub} />
          <DesignCard
            kind={sub}
            style={sub === "timer" ? ov.config.timerStyle : ov.config.winsStyle}
            onChange={(s) =>
              ov.saveConfig(
                sub === "timer" ? { ...ov.config!, timerStyle: s } : { ...ov.config!, winsStyle: s },
              )
            }
          />
          <div>
            <Btn onClick={() => onOpenModule(sub === "timer" ? "temporizador" : "wins")}>
              Ir a {sub === "timer" ? "Temporizador" : "Wins"} (control y configuración)
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
