import type { AgentMessage } from "@streamtok/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMicrofono } from "../lib/use-microfono";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, Field, inputStyle } from "./overlays-ui";

const KEY = "streamtok.agente.escucha";
type Heard = { id: string; ok: boolean; text: string; intent: "stop" | "ask" | "none"; message: string };

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * «Micrófono» (ADR 0024, §8): elige tu micrófono, mira el nivel y prueba. Con «Escuchar mi voz» el agente te atiende:
 * di su nombre y «para» para callarlo, o su nombre y una pregunta. Solo se envía a Gemini lo que suena (con tu clave de Gemini).
 */
export function AgenteMicrofono({ client, name }: { client: SidecarClient | null; name: string }) {
  const [listen, setListen] = useState(readOn);
  const [heard, setHeard] = useState<Heard[]>([]);
  const seq = useRef(0);
  const onSegment = useCallback(
    (data: string) => {
      client?.send("agente", { kind: "listen-audio", id: `v${++seq.current}`, data } satisfies AgentMessage);
    },
    [client],
  );
  const m = useMicrofono(listen ? onSegment : undefined);
  const on = m.status === "listening";
  const color = m.level > 0.85 ? "#E5484D" : m.level > 0.6 ? "#F5A524" : "#30A46C";

  useEffect(() => {
    if (!client) return;
    return client.on((evt) => {
      if (evt.channel !== "agente") return;
      const msg = evt.payload as AgentMessage;
      if (msg.kind === "heard") setHeard((h) => [{ id: msg.id, ok: msg.ok, text: msg.text, intent: msg.intent, message: msg.message }, ...h].slice(0, 5));
    });
  }, [client]);

  const toggle = (v: boolean) => {
    setListen(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* sin guardado */
    }
    if (v && !on) m.start();
  };
  const label = (h: Heard) => (!h.ok ? h.message : h.intent === "stop" ? "→ la callaste" : h.intent === "ask" ? "→ pregunta enviada a la IA" : "→ no era para la IA");

  return (
    <Card title="Micrófono">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Elige con qué micrófono hablarás a la IA. Pulsa «Activar» y habla: la barra debe moverse. Con «Probar» se graban 3 segundos y se reproducen (esa prueba no sale de tu equipo).
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
        <span style={{ fontSize: 12, color: "#9A9CA5", minWidth: 90 }}>{on ? (listen ? "Escuchando" : "Encendido") : "Apagado"}</span>
      </div>
      {m.error && <div style={{ fontSize: 12.5, color: "#E5484D", lineHeight: 1.5 }}>{m.error}</div>}

      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={listen} onChange={(e) => toggle(e.target.checked)} />
        Escuchar mi voz
      </label>
      <div style={{ fontSize: 12, color: "#9A9CA5", lineHeight: 1.5 }}>
        Di «{name}, para» para callarla al instante, o «{name}» y tu pregunta para que la responda. Solo se manda a Gemini lo que suena (cuenta contra el tope de llamadas y usa tu clave de Gemini); el resto del micrófono no se envía. Mantén el micrófono encendido mientras transmites.
      </div>
      {heard.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {heard.map((h) => (
            <div key={h.id} style={{ fontSize: 12.5, color: h.ok ? "#C9CBD2" : "#E5484D" }}>
              {h.ok && h.text ? <>«{h.text}» </> : null}
              <span style={{ color: h.ok ? "#9A9CA5" : "#E5484D" }}>{label(h)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
