import type { OverlaysState } from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useOverlays, type Ov } from "../lib/use-overlays";
import { useTestRunner } from "../lib/use-test-runner";
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
  // Test: suma de a 1 a intervalos al azar hasta la meta (o 10 si no hay meta). "Detener" lo deja donde estaba.
  const cap = w.goal > 0 ? w.goal : w.count + 10;
  const seen = useRef(w.count);
  seen.current = w.count;
  const { running, start, stop } = useTestRunner(() => {
    if (seen.current >= cap) return null;
    ov.winsControl("add", 1);
    seen.current += 1;
    return seen.current >= cap ? null : 700 + Math.random() * 1100;
  });

  return (
    <>
      <UrlCard kind="wins" title="Overlay" stable onCustomize={onCustomize} />

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
            <Btn
              onClick={() => {
                stop();
                ov.winsControl("reset");
              }}
            >
              Reiniciar
            </Btn>
            <Btn primary onClick={() => ov.winsControl("add", Math.max(1, Math.round(w.goal * 0.1)))}>
              Testear (+10 %)
            </Btn>
            <Btn onClick={running ? stop : start} disabled={!running && w.goal > 0 && w.count >= w.goal}>
              {running ? "■ Detener" : "▶ Iniciar test"}
            </Btn>
          </div>
        </div>
        <div style={grid3}>
          <Field label="Conteo" hint="cuántos van; puede ser negativo">
            <NumberField value={w.count} integer onCommit={(v) => ov.winsControl("set", v)} />
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
          Desde un Evento puedes sumar o quitar wins con los comandos “Wins: sumar/restar” y “Wins: quitar”. Si quitan más
          de los que llevas, el conteo queda en negativo y tienes que recuperarlos antes de avanzar hacia la meta.
        </div>
      </Card>

    </>
  );
}
