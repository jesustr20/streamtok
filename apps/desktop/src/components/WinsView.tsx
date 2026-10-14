import type { OverlaysState } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { useOverlays, type Ov } from "../lib/use-overlays";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, Field, NumberField, UrlCard, grid3, inputStyle } from "./overlays-ui";

/** Módulo "Wins": enlace del overlay y control de meta y conteo. */
export function WinsView({ client, onCustomize }: { client: SidecarClient | null; onCustomize: () => void }) {
  const ov = useOverlays(client);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Wins</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Meta y conteo de wins, p. ej. 2 / 6. Lo sumas tú o un Evento.
        </p>
      </div>
      {!ov.config || !ov.state ? (
        <div style={{ padding: 18, background: "#17181D", border: "1px solid #2A2C33", borderRadius: 14, color: "#9A9CA5", fontSize: 13 }}>
          Conectando con el sidecar…
        </div>
      ) : (
        <>
          {ov.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{ov.error}</div>}
          <WinsPage state={ov.state} ov={ov} onCustomize={onCustomize} />
        </>
      )}
    </div>
  );
}

function WinsPage({ state, ov, onCustomize }: { state: OverlaysState; ov: Ov; onCustomize: () => void }) {
  const w = state.wins;
  const [title, setTitle] = useState(w.title);
  useEffect(() => setTitle(w.title), [w.title]);

  return (
    <>
      <UrlCard kind="wins" title="Overlay" onCustomize={onCustomize} />

      <Card title="Control">
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {w.count} <span style={{ color: "#5B5D66" }}>/</span> {w.goal}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => ov.winsControl("add", -1)}>− 1</Btn>
            <Btn primary onClick={() => ov.winsControl("add", 1)}>
              + 1
            </Btn>
            <Btn onClick={() => ov.winsControl("reset")}>Reiniciar</Btn>
          </div>
        </div>
        <div style={grid3}>
          <Field label="Conteo" hint="cuántos van">
            <NumberField value={w.count} min={0} integer onCommit={(v) => ov.winsControl("set", v)} />
          </Field>
          <Field label="Meta" hint="cuántos quieres lograr">
            <NumberField value={w.goal} min={0} integer onCommit={(v) => ov.winsControl("set-goal", v)} />
          </Field>
          <Field label="Título" hint="lo muestra el diseño StreamTok">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== w.title && ov.winsControl("set-title", title)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              style={inputStyle}
            />
          </Field>
        </div>
        <div style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          También puedes sumar wins desde un Evento con el comando “Wins: sumar/restar”.
        </div>
      </Card>

    </>
  );
}
