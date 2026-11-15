import { useMicrofono } from "../lib/use-microfono";
import { Btn, Card, Field, inputStyle } from "./overlays-ui";

/**
 * «Micrófono» (ADR 0024, §8, fase 6): elige tu micrófono, mira el nivel en vivo y haz una prueba de 3 segundos.
 * Es la base para hablarle a la IA y para decirle «para» con la voz (siguiente fase). Nada se envía a ningún sitio.
 */
export function AgenteMicrofono() {
  const m = useMicrofono();
  const on = m.status === "listening";
  const color = m.level > 0.85 ? "#E5484D" : m.level > 0.6 ? "#F5A524" : "#30A46C";

  return (
    <Card title="Micrófono">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Elige con qué micrófono hablarás a la IA. Pulsa «Activar» y habla: la barra debe moverse. Con «Probar» se graban 3 segundos y se reproducen.
        El audio no sale de tu equipo en esta prueba.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: 320, maxWidth: "100%" }}>
          <Field label="Entrada de audio" hint="se recuerda en este equipo">
            <select value={m.deviceId} onChange={(e) => m.setDeviceId(e.target.value)} style={inputStyle}>
              <option value="">Predeterminado de Windows</option>
              {m.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {on ? <Btn onClick={m.stop}>Apagar</Btn> : <Btn onClick={m.start}>{m.status === "starting" ? "Abriendo…" : "Activar"}</Btn>}
        <Btn onClick={m.test}>{m.testing === "recording" ? "Grabando 3 s…" : m.testing === "playing" ? "Reproduciendo…" : "Probar"}</Btn>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 10, borderRadius: 6, background: "#1c1c1c", overflow: "hidden", maxWidth: 420 }}>
          <div style={{ width: `${Math.round(m.level * 100)}%`, height: "100%", background: color, transition: "width 60ms linear" }} />
        </div>
        <span style={{ fontSize: 12, color: "#9A9CA5", minWidth: 90 }}>{on ? "Escuchando" : "Apagado"}</span>
      </div>
      {m.error && <div style={{ fontSize: 12.5, color: "#E5484D", lineHeight: 1.5 }}>{m.error}</div>}
    </Card>
  );
}
