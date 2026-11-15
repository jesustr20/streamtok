import type { AgentConfig } from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useAgenteMemoria } from "../lib/use-agente-memoria";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, Field, NumberField, inputStyle } from "./overlays-ui";

/** Un pitido corto para avisar que el agente te pregunta algo (sin archivos de audio). */
function beep() {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.35);
    setTimeout(() => void ac.close(), 600);
  } catch {
    /* sin sonido */
  }
}

const MODES: { id: AgentConfig["streamerAsk"]; label: string; hint: string }[] = [
  { id: "mixto", label: "Mixto", hint: "te pregunta solo si parece importante; si no, dice que no lo sabe" },
  { id: "preguntar", label: "Preguntar siempre", hint: "cuando no sabe algo tuyo, te lo pregunta" },
  { id: "solo-memoria", label: "Solo lo que sabe", hint: "nunca te pregunta; dice que no lo sabe" },
];

/**
 * «Preguntas al streamer» (ADR 0024, §3): cuando alguien pregunta algo tuyo que el agente no sabe, aquí aparece la
 * pregunta para que la contestes. Tu respuesta queda guardada como dato tuyo y el agente se la dice a quien preguntó.
 */
export function AgentePreguntas({ client, config, patch }: { client: SidecarClient | null; config: AgentConfig; patch: (p: Partial<AgentConfig>) => void }) {
  const m = useAgenteMemoria(client);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const seen = useRef<Set<string> | null>(null);
  const list = m.pendientes;

  useEffect(() => {
    const ids = new Set(list.map((p) => p.id));
    // la primera carga no suena; después, cada pregunta nueva sí
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) beep();
    seen.current = ids;
  }, [list]);

  const mode = MODES.find((x) => x.id === config.streamerAsk) ?? MODES[0]!;
  const send = (id: string) => {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    m.answerPending(id, text);
    setDrafts((d) => ({ ...d, [id]: "" }));
  };

  return (
    <Card title="Preguntas al streamer">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Si el chat pregunta algo tuyo que el agente no sabe, en vez de inventarlo te lo pregunta aquí (con un pitido). Lo que respondas se guarda como dato tuyo y el agente se lo cuenta a quien preguntó.
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 240 }}>
          <Field label="Cuando no sabe algo tuyo" hint={mode.hint}>
            <select value={config.streamerAsk} onChange={(e) => patch({ streamerAsk: e.target.value as AgentConfig["streamerAsk"] })} style={inputStyle}>
              {MODES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ width: 150 }}>
          <Field label="Espera (segundos)" hint="luego lo deja anotado">
            <NumberField value={config.streamerAskTimeoutSec} min={5} integer onCommit={(v) => patch({ streamerAskTimeoutSec: Math.min(300, Math.max(5, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 150 }}>
          <Field label="Máx. por LIVE" hint="preguntas que te hace">
            <NumberField value={config.maxStreamerAsks} min={1} integer onCommit={(v) => patch({ maxStreamerAsks: Math.min(100, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: "#7C7E88" }}>No hay preguntas pendientes.</div>
      ) : (
        list.map((p) => (
          <div key={p.id} style={{ border: "1px solid #F5A524", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              <b>{p.asker || "Alguien"}</b> preguntó: «{p.question}»
            </div>
            <input
              value={drafts[p.id] ?? ""}
              maxLength={250}
              placeholder="Tu respuesta…"
              onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && send(p.id)}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn onClick={() => send(p.id)}>Responder</Btn>
              <Btn onClick={() => m.dismissPending(p.id, true)}>No quiero contestar</Btn>
              <Btn onClick={() => m.dismissPending(p.id, false)}>Ignorar</Btn>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
