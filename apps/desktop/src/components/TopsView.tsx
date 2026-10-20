import {
  TOP_MAX_COUNT,
  TOP_METRIC_NAMES,
  TOP_PERIOD_NAMES,
  TopMetricSchema,
  TopPeriodSchema,
  type TopConfig,
  type TopMetric,
  type TopPeriod,
  type TopState,
} from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useTestRunner } from "../lib/use-test-runner";
import { useTops } from "../lib/use-tops";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, DesignCard, Field, NumberField, UrlCard, cardStyle, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useTops>;

/** Recuadro de la vista previa: la lista crece con los puestos; el podio tiene alto fijo. */
function reserveFor(config: TopConfig): { w: number; h: number } {
  return config.style.designId === "podio" ? { w: 500, h: 340 } : { w: 440, h: 80 + config.count * 54 };
}

/** Qué hace cada top de fábrica, para explicarlo en pantalla. */
const INTRO: Record<string, string> = {
  gifters: "Los espectadores que más monedas han regalado en este LIVE, con su foto. Se reinicia solo cuando te conectas a otro LIVE.",
  "gifters-dia": "Los que más monedas han regalado hoy, en podio. Sigue contando entre LIVEs y se reinicia a medianoche (hora de tu equipo).",
  likes: "Quienes más likes han dado en este LIVE.",
  comentarios: "Quienes más han escrito en el chat en este LIVE.",
  compartidos: "Quienes más veces han compartido tu LIVE.",
  trivia: "Quienes más han acertado en la trivia del agente (Agente IA). Sigue contando entre LIVEs y se reinicia a medianoche.",
};

/** Módulo "Tops y MVP": una pantalla por ranking, ya creado y con su vista previa. */
export function TopsView({ client, selected }: { client: SidecarClient | null; selected: string }) {
  const api = useTops(client);
  const config = api.configs?.find((c) => c.id === selected);
  const heading = config ? `Tops · ${config.title || config.id}` : "Tops y MVP";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>{heading}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Rankings de tus espectadores con su foto. Elige el ranking en el menú de la izquierda.
        </p>
      </div>
      {api.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{api.error}</div>}
      {!api.configs ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : config ? (
        <TopBlock key={config.id} config={config} state={api.states.find((s) => s.id === config.id)} api={api} />
      ) : (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Este ranking no existe.</div>
      )}
    </div>
  );
}

function TopBlock({ config, state, api }: { config: TopConfig; state: TopState | undefined; api: Api }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<TopConfig>) => api.save({ ...config, ...p });
  return (
    <>
      <Card title="Cómo funciona">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          {INTRO[config.id] ?? `Cuenta: ${TOP_METRIC_NAMES[config.metric].toLowerCase()}.`}
        </div>
      </Card>

      <Settings config={config} patch={patch} />
      <Ranking config={config} state={state} api={api} />

      <UrlCard
        kind="top"
        id={config.id}
        title="Overlay"
        stable
        reserve={reserveFor(config)}
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="top" id={config.id} style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

/** Título, qué se cuenta, período y cuántos puestos. */
function Settings({ config, patch }: { config: TopConfig; patch: (p: Partial<TopConfig>) => void }) {
  const podio = config.style.designId === "podio";
  return (
    <Card title="Configuración">
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field label="Título" hint="se muestra sobre el ranking; déjalo vacío para el título de fábrica">
            <CommitInput value={config.title} max={60} onCommit={(v) => patch({ title: v })} />
          </Field>
        </div>
        <div style={{ width: 210 }}>
          <Field label="Qué se cuenta" hint="al cambiarlo, el ranking empieza de cero">
            <select
              value={config.metric}
              onChange={(e) => patch({ metric: e.target.value as TopMetric })}
              style={{ ...inputStyle, width: "100%" }}
            >
              {TopMetricSchema.options.map((m) => (
                <option key={m} value={m}>
                  {TOP_METRIC_NAMES[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ width: 210 }}>
          <Field label="Período" hint="“Del día” sigue entre LIVEs y se reinicia a medianoche">
            <select
              value={config.period}
              onChange={(e) => patch({ period: e.target.value as TopPeriod })}
              style={{ ...inputStyle, width: "100%" }}
            >
              {TopPeriodSchema.options.map((p) => (
                <option key={p} value={p}>
                  {TOP_PERIOD_NAMES[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ width: 130 }}>
          <Field label="Puestos" hint={podio ? "el podio siempre enseña 3" : `de 1 a ${TOP_MAX_COUNT}`}>
            <NumberField
              value={config.count}
              min={1}
              integer
              onCommit={(v) => patch({ count: Math.min(TOP_MAX_COUNT, Math.max(1, Math.round(v))) })}
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}

const TEST_NAMES = ["Valentina", "Carlos_92", "Luna", "Diego", "Mia", "Joaquín", "Sofi", "Andrés", "Cami", "Nico"];
const TEST_AMOUNTS: Record<TopMetric, number[]> = {
  coins: [1, 5, 30, 100, 500],
  likes: [5, 12, 25, 40],
  comments: [1, 1, 2],
  shares: [1, 1, 2],
  trivia: [1, 1, 2],
};
const TEST_MAX = 30;
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** Ranking en vivo, con los botones de prueba. Las personas de prueba solo cuentan en este ranking. */
function Ranking({ config, state, api }: { config: TopConfig; state: TopState | undefined; api: Api }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const entries = state?.entries ?? [];
  const leader = entries[0]?.score ?? 0;

  const { running, count, start, stop } = useTestRunner((n) => {
    api.test(config.id, pick(TEST_NAMES), pick(TEST_AMOUNTS[config.metric]));
    return n + 1 >= TEST_MAX ? null : 350 + Math.random() * 1150;
  });
  // "Testear (+10 %)": un golpe del 10 % del primer puesto (mínimo 1) a alguien de prueba.
  const testTen = () => api.test(config.id, pick(TEST_NAMES), Math.max(1, Math.round(leader * 0.1)));
  const askReset = () => {
    if (!confirm) {
      setConfirm(true);
      timer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirm(false);
    stop();
    api.reset(config.id);
  };

  return (
    <Card title="Ranking en vivo">
      {entries.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9A9CA5" }}>Aún no hay nadie. Pulsa «Iniciar test» para ver cómo queda en el overlay.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map((e, i) => (
            <div
              key={`${i}-${e.name}`}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 10, background: "#0E0F12", fontSize: 13.5 }}
            >
              <span style={{ width: 22, fontWeight: 800, color: i === 0 ? "#FFC233" : i === 1 ? "#C5CCD6" : i === 2 ? "#D98A4A" : "#7C7E88" }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{e.name}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{e.score.toLocaleString("es")}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={running ? stop : start}>{running ? `■ Detener (${count}/${TEST_MAX})` : "▶ Iniciar test"}</Btn>
        <Btn primary onClick={testTen}>
          Testear (+10 %)
        </Btn>
        <Btn onClick={askReset}>{confirm ? "¿Seguro? Pulsa otra vez" : "Reiniciar ranking"}</Btn>
        <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          «Iniciar test» manda gente de prueba al azar (solo cuenta en este ranking, no activa Acciones). «Reiniciar ranking» lo deja en cero.
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
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}
