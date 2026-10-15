import { useOverlays } from "../lib/use-overlays";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, DesignCard, UrlCard, cardStyle } from "./overlays-ui";

/**
 * Sección "Overlays": galería de lo que se ve en el stream. Por cada overlay, su
 * enlace, la lista de diseños, la vista previa y la personalización. Hoy solo
 * tiene Wins: el temporizador vive entero en su módulo (con tamaño fijo, como en
 * Interactive). El control y la configuración de Wins están en el módulo Wins.
 */
export function OverlaysView({
  client,
  onOpenWins,
}: {
  client: SidecarClient | null;
  onOpenWins: () => void;
}) {
  const ov = useOverlays(client);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Overlays</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Elementos que se ven en tu stream. Pega el enlace como fuente en TikTok LIVE Studio u OBS. El temporizador
          tiene su propio módulo.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...cardStyle, flex: 1, borderColor: "#E23A57" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Wins</div>
          <div style={{ fontSize: 12, color: "#9A9CA5", marginTop: 3 }}>Meta y conteo, p. ej. 2 / 6</div>
        </div>
      </div>

      {!ov.config ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : (
        <>
          {ov.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{ov.error}</div>}
          <UrlCard kind="wins" />
          <DesignCard
            kind="wins"
            style={ov.config.winsStyle}
            onChange={(s) => ov.saveConfig({ ...ov.config!, winsStyle: s })}
          />
          <div>
            <Btn onClick={onOpenWins}>Ir a Wins (control y configuración)</Btn>
          </div>
        </>
      )}
    </div>
  );
}
