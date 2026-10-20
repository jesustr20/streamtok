import { AGENT_PROVIDERS, TRIVIA_DIFFICULTY_NAMES, pickVoice, type AgentTriviaConfig, providerInfo, type AgentVoice, type AgentConfig, type AgentEligibility, type AgentKeyStatus, type AgentProviderId, type AgentState } from "@streamtok/shared";
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
        <Block config={api.config} state={api.state} keys={api.keys ?? { deepseek: false, openai: false, gemini: false, claude: false }} api={api} />
      )}
    </div>
  );
}

function Block({ config, state, keys, api }: { config: AgentConfig; state: AgentState; keys: AgentKeyStatus; api: Api }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<AgentConfig>) => api.save({ ...config, ...p });
  return (
    <>
      <Card title="Cómo funciona">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          Quien cumpla lo que marques abajo escribe <b>{config.command} su pregunta</b> en el chat y entra a la cola. Las preguntas de quienes
          mandaron regalos pasan primero (más monedas, antes); las demás salen una cada {config.freeEverySec} segundos. Las respuestas las da el modelo que elijas
          abajo, con tu propia clave.
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

      <Modelo config={config} keys={keys} api={api} patch={patch} />

      <Voz config={config} patch={patch} />

      <Trivia config={config} api={api} patch={patch} hasKey={keys[config.provider]} />

      <Queue config={config} state={state} api={api} />

      <UrlCard kind="agente" title="Overlay" stable reserve={{ w: 480, h: 440 }} onCustomize={() => setOpen((v) => !v)} customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"} />
      {open && <DesignCard kind="agente" style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

/** Voces del sistema instaladas (en Windows llegan un momento después de abrir la página). */
function useSystemVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices()));
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

/** Voz del agente: lee la respuesta en voz alta desde el overlay con una voz del sistema. */
function Voz({ config, patch }: { config: AgentConfig; patch: (p: Partial<AgentConfig>) => void }) {
  const voices = useSystemVoices();
  const spanish = voices.filter((v) => /^es/i.test(v.lang));
  const v = config.voice;
  const set = (p: Partial<AgentVoice>) => patch({ voice: { ...v, ...p } });
  const chosen = pickVoice(voices, v);

  const preview = () => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`Hola, soy ${config.name}. Pregúntame lo que quieras con ${config.command}.`);
    if (chosen) {
      u.voice = chosen;
      u.lang = chosen.lang;
    } else u.lang = "es-ES";
    u.rate = v.rate;
    u.volume = v.volume;
    speechSynthesis.speak(u);
  };

  return (
    <Card title="Voz">
      <div style={{ fontSize: 12.5, color: "#9A9CA5", lineHeight: 1.5 }}>
        El overlay lee cada respuesta en voz alta con una voz instalada en tu equipo. TikTok LIVE Studio la reproduce sola; en OBS activa «Controlar audio mediante OBS» en la fuente de navegador.
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 120 }}>
          <Field label="Voz activada" hint="apagada, solo se lee en pantalla">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              {v.enabled ? "Sí" : "No"}
            </label>
          </Field>
        </div>
        <div style={{ width: 150 }}>
          <Field label="Tipo de voz" hint="busca una voz así entre las instaladas">
            <select value={v.gender} onChange={(e) => set({ gender: e.target.value as AgentVoice["gender"], voiceName: "" })} style={{ ...inputStyle, width: "100%" }}>
              <option value="female">Mujer</option>
              <option value="male">Hombre</option>
            </select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Field
            label="Voz concreta"
            hint={spanish.length === 0 ? "no se encontró ninguna voz en español: instálala en Windows (Configuración → Hora e idioma → Voz)" : chosen ? `ahora: ${chosen.name}` : "automática"}
          >
            <select value={v.voiceName} onChange={(e) => set({ voiceName: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
              <option value="">Automática</option>
              {spanish.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: 200 }}>
          <Field label={`Velocidad (${v.rate.toFixed(2)}×)`} hint="1 = normal">
            <input type="range" min={0.5} max={1.8} step={0.05} value={v.rate} onChange={(e) => set({ rate: Number(e.target.value) })} />
          </Field>
        </div>
        <div style={{ width: 200 }}>
          <Field label={`Volumen (${Math.round(v.volume * 100)} %)`} hint="">
            <input type="range" min={0} max={1} step={0.05} value={v.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
          </Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, paddingBottom: 6 }}>
          <input type="checkbox" checked={v.readQuestion} onChange={(e) => set({ readQuestion: e.target.checked })} />
          Leer también la pregunta
        </label>
        <Btn primary onClick={preview}>
          ▶ Probar voz
        </Btn>
      </div>
    </Card>
  );
}

/** Trivia: el agente lanza preguntas con opciones cuando el chat está tranquilo. */
function Trivia({ config, api, patch, hasKey }: { config: AgentConfig; api: Api; patch: (p: Partial<AgentConfig>) => void; hasKey: boolean }) {
  const t = config.trivia;
  const set = (p: Partial<AgentTriviaConfig>) => patch({ trivia: { ...t, ...p } });
  const st = api.trivia;
  const busy = st !== null && st.phase !== "idle";
  const PHASE: Record<string, string> = { idle: "En reposo", generating: "Preparando la pregunta…", open: "Abierta: la gente está respondiendo", reveal: "Enseñando la respuesta" };
  return (
    <Card title="Trivia">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Cuando nadie comenta ni regala durante un rato, el agente lanza una pregunta con opciones. La gente responde escribiendo la letra (A, B, C o D) y el
        primero que acierta gana: su próxima pregunta al agente pasa primero y suma un acierto en <b>Top Trivia</b> (Overlays → Tops y MVP). Cada pregunta
        gasta una llamada del modelo.
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 150 }}>
          <Field label="Trivia automática" hint={hasKey ? "sale sola con el chat quieto" : "necesita una clave de modelo guardada"}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={t.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              {t.enabled ? "Activada" : "Apagada"}
            </label>
          </Field>
        </div>
        <div style={{ width: 170 }}>
          <Field label="Chat callado (seg.)" hint="sin comentarios ni regalos">
            <NumberField value={t.idleSec} min={15} integer onCommit={(v) => set({ idleSec: Math.min(1800, Math.max(15, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 170 }}>
          <Field label="Tiempo para responder (seg.)" hint="">
            <NumberField value={t.answerSec} min={10} integer onCommit={(v) => set({ answerSec: Math.min(120, Math.max(10, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 130 }}>
          <Field label="Opciones" hint="">
            <select value={t.options} onChange={(e) => set({ options: Number(e.target.value) as 3 | 4 })} style={{ ...inputStyle, width: "100%" }}>
              <option value={3}>3 (A, B, C)</option>
              <option value={4}>4 (A a D)</option>
            </select>
          </Field>
        </div>
        <div style={{ width: 130 }}>
          <Field label="Dificultad" hint="">
            <select value={t.difficulty} onChange={(e) => set({ difficulty: e.target.value as AgentTriviaConfig["difficulty"] })} style={{ ...inputStyle, width: "100%" }}>
              {(Object.keys(TRIVIA_DIFFICULTY_NAMES) as AgentTriviaConfig["difficulty"][]).map((d) => (
                <option key={d} value={d}>
                  {TRIVIA_DIFFICULTY_NAMES[d]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Field label="Temas" hint="separados por comas; el agente elige uno al azar">
            <CommitInput value={t.topics} max={200} onCommit={(v) => set({ topics: v })} />
          </Field>
        </div>
        <div style={{ width: 170 }}>
          <Field label="Máximo por hora" hint="protege tu saldo">
            <NumberField value={t.maxPerHour} min={1} integer onCommit={(v) => set({ maxPerHour: Math.min(60, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 170 }}>
          <Field label="Premio (monedas de prioridad)" hint="qué tan rápido pasa su pregunta">
            <NumberField value={t.prizeCoins} min={1} integer onCommit={(v) => set({ prizeCoins: Math.min(1000, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={() => api.startTrivia(true)} disabled={busy}>
          ▶ Trivia de prueba
        </Btn>
        <Btn primary onClick={() => api.startTrivia(false)} disabled={busy || !hasKey}>
          Lanzar trivia con el modelo
        </Btn>
        <Btn onClick={api.cancelTrivia} disabled={!busy}>
          Cancelar
        </Btn>
        <span style={{ fontSize: 12, color: "#9A9CA5" }}>
          {st ? `${PHASE[st.phase]}${st.phase === "open" ? ` · ${st.answers} respuestas` : ""}` : ""}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "#9A9CA5" }}>
        «Trivia de prueba» usa preguntas de ejemplo (sin clave ni gasto). Para probar la respuesta, escribe la letra desde el chat del LIVE; en la app puedes mirar el overlay de abajo.
      </div>
    </Card>
  );
}

const KEY_STATE_COLORS = { ok: "#5BE37D", bad: "#E5484D" };

/** Proveedor de modelo: claves propias (solo se guardan en tu equipo), «Probar conexión» y cuál usar. */
function Modelo({ config, keys, api, patch }: { config: AgentConfig; keys: AgentKeyStatus; api: Api; patch: (p: Partial<AgentConfig>) => void }) {
  const withKey = AGENT_PROVIDERS.filter((p) => keys[p.id]);
  const info = providerInfo(config.provider);
  return (
    <Card title="Modelo de IA">
      <div style={{ fontSize: 12.5, color: "#9A9CA5", lineHeight: 1.5 }}>
        Usa tu propia clave de API. Se guarda solo en este equipo, la lee únicamente el sidecar y nunca se muestra de nuevo ni se manda al overlay.
        Cada respuesta consume saldo de tu cuenta con el proveedor: puedes limitarlo abajo.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AGENT_PROVIDERS.map((p) => (
          <ProviderRow key={p.id} id={p.id} has={keys[p.id]} api={api} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 220 }}>
          <Field label="Modelo en uso" hint={withKey.length === 0 ? "guarda una clave para poder elegir" : "solo aparecen los que tienen clave"}>
            <select
              value={keys[config.provider] ? config.provider : ""}
              disabled={withKey.length === 0}
              onChange={(e) => patch({ provider: e.target.value as AgentProviderId, model: "" })}
              style={{ ...inputStyle, width: "100%" }}
            >
              {!keys[config.provider] && <option value="">— elige uno —</option>}
              {withKey.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ width: 240 }}>
          <Field label="Nombre del modelo" hint={`vacío = ${info.defaultModel}`}>
            <CommitInput value={config.model} max={80} onCommit={(v) => patch({ model: v })} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field label="Cómo habla (opcional)" hint="tono o humor; las reglas de seguridad no se pueden cambiar">
            <CommitInput value={config.personality} max={300} onCommit={(v) => patch({ personality: v })} />
          </Field>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 200 }}>
          <Field label="Tope de respuestas por LIVE" hint={`llevas ${api.modelCalls} en este LIVE`}>
            <NumberField value={config.maxModelCalls} min={1} integer onCommit={(v) => patch({ maxModelCalls: Math.min(5000, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 200 }}>
          <Field label="Espera entre preguntas (seg.)" hint="por persona, contra el spam">
            <NumberField value={config.userCooldownSec} min={0} integer onCommit={(v) => patch({ userCooldownSec: Math.min(3600, Math.max(0, Math.round(v))) })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function ProviderRow({ id, has, api }: { id: AgentProviderId; has: boolean; api: Api }) {
  const [text, setText] = useState("");
  const info = providerInfo(id);
  const test = api.tests[id];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", borderRadius: 10, background: "#0E0F12" }}>
      <span style={{ width: 90, fontWeight: 700, fontSize: 13 }}>{info.name}</span>
      {has ? (
        <>
          <span style={{ fontSize: 12.5, color: KEY_STATE_COLORS.ok }}>● Clave guardada</span>
          <Btn onClick={() => api.testConnection(id)} disabled={test === "pending"}>
            {test === "pending" ? "Probando…" : "Probar conexión"}
          </Btn>
          <Btn onClick={() => api.removeKey(id)}>Quitar clave</Btn>
          {test && test !== "pending" && (
            <span style={{ fontSize: 12, color: test.ok ? KEY_STATE_COLORS.ok : KEY_STATE_COLORS.bad }}>
              {test.ok ? `✔ ${test.message} (${test.ms} ms)` : `✖ ${test.message}`}
            </span>
          )}
        </>
      ) : (
        <>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={text}
            placeholder={`Clave de ${info.name} (${info.keyUrl})`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim().length >= 8) {
                api.setKey(id, text.trim());
                setText("");
              }
            }}
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <Btn
            primary
            disabled={text.trim().length < 8}
            onClick={() => {
              api.setKey(id, text.trim());
              setText("");
            }}
          >
            Guardar
          </Btn>
        </>
      )}
    </div>
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
