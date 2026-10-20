import type { AgentConfig, AgentEligibility, AgentState } from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useAgente } from "../lib/use-agente";
import { useTestRunner } from "../lib/use-test-runner";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, DesignCard, Field, NumberField, UrlCard, cardStyle, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useAgente>;

const ELIGIBILITY: { key: keyof AgentEligibility; label: string; hint: string }[] = [
  { key: "follow", label: "Quien te sigue", hint: "TikTok avisa si sigue tu canal en cada comentario" },
  { key: "share", label: "Quien compartió el LIVE", hint: "cuenta desde que comparte, en este LIVE" },
  { key: "fanClub", label: "Fan Club («Quiéreme»)", hint: "quien tiene nivel de Fan Club o mandó el regalo «Heart Me»" },
  { key: "gift", label: "Quien mandó un regalo", hint: "su pregunta pasa antes cuantas más monedas haya regalado" },
];

/** Módulo "Agente IA" (ADR 0016). Pieza 1: la cola y el overlay; todavía responde un texto de prueba, sin modelo. */
export function AgenteView({ client }: { client: SidecarClient | null }) {
  const api = useAgente(client);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Agente IA</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Tus espectadores le hacen preguntas con un comando del chat y el agente responde en pantalla. Los regalos dan prioridad.
        </p>
      </div>
      {api.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{api.error}</div>}
      {!api.config || !api.state ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : (
        <Block config={api.config} state={api.state} api={api} />
      )}
    </div>
  );
}

function Block({ config, state, api }: { config: AgentConfig; state: AgentState; api: Api }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<AgentConfig>) => api.save({ ...config, ...p });
  return (
    <>
      <Card title="Cómo funciona">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          Quien cumpla lo que marques abajo escribe <b>{config.command} su pregunta</b> en el chat y entra a la cola. Las preguntas de quienes
          mandaron regalos pasan primero (más monedas, antes); las demás salen una cada {config.freeEverySec} segundos. Por ahora el agente contesta un
          texto de prueba: el modelo (DeepSeek, OpenAI, Claude…) se conecta en el siguiente paso.
        </div>
      </Card>

      <Card title="Configuración">
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 130, display: "flex", flexDirection: "column", gap: 4 }}>
            <Field label="Activado" hint="apagado, ignora el chat">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                {config.enabled ? "Sí" : "No"}
              </label>
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Nombre del agente" hint="sale en la barra del overlay">
              <CommitInput value={config.name} max={30} onCommit={(v) => v && patch({ name: v })} />
            </Field>
          </div>
          <div style={{ width: 150 }}>
            <Field label="Comando" hint="sin espacios, p. ej. !ia">
              <CommitInput value={config.command} max={20} onCommit={(v) => /^\S+$/.test(v) && patch({ command: v })} />
            </Field>
          </div>
          <div style={{ width: 150 }}>
            <Field label="Gratis cada (seg.)" hint="una pregunta sin regalo cada tanto">
              <NumberField value={config.freeEverySec} min={5} integer onCommit={(v) => patch({ freeEverySec: Math.min(600, Math.max(5, Math.round(v))) })} />
            </Field>
          </div>
          <div style={{ width: 150 }}>
            <Field label="Crédito del regalo (min.)" hint="cuánto vale un regalo para preguntar">
              <NumberField value={config.giftCreditMin} min={1} integer onCommit={(v) => patch({ giftCreditMin: Math.min(120, Math.max(1, Math.round(v))) })} />
            </Field>
          </div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>¿Quién puede preguntar?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ELIGIBILITY.map((e) => (
            <label
              key={e.key}
              title={e.hint}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "#0E0F12", fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={config.eligibility[e.key]}
                onChange={(ev) => patch({ eligibility: { ...config.eligibility, [e.key]: ev.target.checked } })}
              />
              {e.label}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#7C7E88" }}>
          Si no marcas ninguna, nadie puede preguntar por el chat. Pasa el ratón sobre cada una para ver cómo se detecta.
        </div>
      </Card>

      <Queue config={config} state={state} api={api} />

      <UrlCard kind="agente" title="Overlay" stable reserve={{ w: 480, h: 230 }} onCustomize={() => setOpen((v) => !v)} customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"} />
      {open && <DesignCard kind="agente" style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

const TEST_NAMES = ["Valentina", "Carlos_92", "Luna", "Diego", "Mia", "Joaquín", "Sofi", "Andrés"];
const TEST_QUESTIONS = [
  "¿Cuántos planetas tiene el sistema solar?",
  "¿Por qué el cielo es azul?",
  "¿Cuál es la capital de Australia?",
  "¿Quién pintó la Mona Lisa?",
  "¿Cuánto dura un año en Marte?",
  "¿Qué es un agujero negro?",
  "¿Cuál es el animal más rápido del mundo?",
];
const TEST_MAX = 12;
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** La cola en vivo, con los botones de prueba (las preguntas de prueba no pasan por el chat ni piden requisitos). */
function Queue({ config, state, api }: { config: AgentConfig; state: AgentState; api: Api }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const { running, count, start, stop } = useTestRunner((n) => {
    // una de cada cuatro viene respaldada por un regalo
    api.ask(pick(TEST_NAMES), pick(TEST_QUESTIONS), Math.random() < 0.25 ? pick([1, 5, 30, 100]) : 0);
    return n + 1 >= TEST_MAX ? null : 1500 + Math.random() * 3000;
  });
  const testOne = () => api.ask(pick(TEST_NAMES), pick(TEST_QUESTIONS), 0);
  const testGift = () => api.ask(pick(TEST_NAMES), pick(TEST_QUESTIONS), pick([5, 30, 100]));
  const askReset = () => {
    if (!confirm) {
      setConfirm(true);
      timer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirm(false);
    stop();
    api.reset();
  };

  return (
    <Card title="Cola en vivo">
      <div style={{ fontSize: 13, color: "#C9CBD2" }}>
        {state.current ? (
          <>
            Atendiendo a <b>{state.current.name}</b>: «{state.current.question}»
            {state.current.answer ? <div style={{ marginTop: 4, color: "#9A9CA5" }}>→ {state.current.answer}</div> : <span style={{ color: "#9A9CA5" }}> (pensando…)</span>}
          </>
        ) : (
          <span style={{ color: "#9A9CA5" }}>El agente está libre.</span>
        )}
      </div>
      {state.queueSize === 0 ? (
        <div style={{ fontSize: 13, color: "#9A9CA5" }}>La cola está vacía. Pulsa «Iniciar test» para ver cómo queda en el overlay.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {state.queue.map((q, i) => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 10, background: "#0E0F12", fontSize: 13 }}>
              <span style={{ width: 20, fontWeight: 800, color: "#7C7E88" }}>{i + 1}</span>
              <span style={{ fontWeight: 700 }}>{q.name}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#9A9CA5" }}>{q.question}</span>
              {q.coins > 0 && <span style={{ fontWeight: 800, color: "#FFC233" }}>{q.coins.toLocaleString("es")} 🪙</span>}
            </div>
          ))}
          {state.queueSize > state.queue.length && (
            <div style={{ fontSize: 11.5, color: "#7C7E88" }}>y {state.queueSize - state.queue.length} más…</div>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={running ? stop : start}>{running ? `■ Detener (${count}/${TEST_MAX})` : "▶ Iniciar test"}</Btn>
        <Btn primary onClick={testOne}>
          Testear (pregunta)
        </Btn>
        <Btn onClick={testGift}>Testear (con regalo)</Btn>
        <Btn onClick={askReset}>{confirm ? "¿Seguro? Pulsa otra vez" : "Vaciar cola"}</Btn>
        <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          Las preguntas de prueba no piden seguir, compartir ni regalar de verdad, ni activan Acciones. En el chat real: {config.command} y tu pregunta.
        </span>
      </div>
    </Card>
  );
}

/** Campo de texto que guarda al salir del campo o con Enter (no en cada letra). */
function CommitInput({ value, onCommit, max }: { value: string; onCommit: (v: string) => void; max?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      maxLength={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text.trim() !== value ? (text.trim() ? onCommit(text.trim()) : setText(value)) : undefined)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}
