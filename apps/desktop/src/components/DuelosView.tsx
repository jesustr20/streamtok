import { DUEL_METRIC_NAMES, DUEL_MODES, type DuelConfig, type DuelMetric, type DuelSideConfig, type DuelState } from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useDuelos } from "../lib/use-duelos";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, DesignCard, Field, UrlCard, cardStyle, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useDuelos>;
type Side = 0 | 1;

/** Recuadro de la vista previa según el diseño (cada uno tiene su tamaño fijo). */
const RESERVE: Record<string, { w: number; h: number }> = {
  barra: { w: 560, h: 152 },
  versus: { w: 560, h: 266 },
  marcador: { w: 560, h: 146 },
};

/** Qué hace cada duelo de fábrica, para explicarlo en pantalla. */
const INTRO: Record<string, string> = {
  "regalo-vs-regalo":
    "Dos regalos compiten: cada vez que llega uno, suma a su lado. Escribe el nombre del regalo (o su número) de cada lado; puedes poner varios separados por comas. Si un lado tiene un solo regalo es “Gift vs Gift”; con varios, “Regalos vs Regalos”.",
  equipos:
    "La gente elige equipo escribiendo un comando en el chat (por ejemplo !azul o !rojo) y desde ese momento todo lo que haga suma a su equipo. Quien ya eligió se queda en su equipo hasta que reinicies el marcador.",
  top: "Muestra a los dos mayores donadores de esta sesión, con su foto, frente a frente. Se reinicia solo cuando te conectas a otro LIVE.",
};

const MODE_NAMES = Object.fromEntries(DUEL_MODES.map((m) => [m.id, m.name]));

/** Módulo "Batallas y duelos": una pantalla por duelo, ya creado y con su vista previa. */
export function DuelosView({ client, selected }: { client: SidecarClient | null; selected: string }) {
  const api = useDuelos(client);
  const config = api.configs?.find((c) => c.id === selected);
  const heading = config ? `Batallas · ${config.title || config.id}` : "Batallas y duelos";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>{heading}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Dos lados que compiten en pantalla. Elige el duelo en el menú de la izquierda.
        </p>
      </div>
      {api.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{api.error}</div>}
      {!api.configs ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : config ? (
        <DuelBlock key={config.id} config={config} state={api.states.find((s) => s.id === config.id)} api={api} />
      ) : (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Este duelo no existe.</div>
      )}
    </div>
  );
}

function DuelBlock({ config, state, api }: { config: DuelConfig; state: DuelState | undefined; api: Api }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<DuelConfig>) => api.save({ ...config, ...p });
  const patchSide = (i: Side, p: Partial<DuelSideConfig>) => {
    const a = i === 0 ? { ...config.sides[0], ...p } : config.sides[0];
    const b = i === 1 ? { ...config.sides[1], ...p } : config.sides[1];
    patch({ sides: [a, b] });
  };
  const designId = config.style.designId;

  return (
    <>
      <Card title="Cómo funciona">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          {INTRO[config.id] ?? `Modo: ${MODE_NAMES[config.mode]}.`}
        </div>
      </Card>

      <Scoreboard config={config} state={state} api={api} />
      <Settings config={config} patch={patch} patchSide={patchSide} />

      <UrlCard
        kind="duelo"
        id={config.id}
        title="Overlay"
        stable
        reserve={RESERVE[designId] ?? { w: 560, h: 152 }}
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="duelo" id={config.id} style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

/** Marcador en vivo, con botones para corregirlo a mano y reiniciarlo. */
function Scoreboard({ config, state, api }: { config: DuelConfig; state: DuelState | undefined; api: Api }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const askReset = () => {
    if (!confirm) {
      setConfirm(true);
      timer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirm(false);
    api.reset(config.id);
  };
  const manual = config.mode !== "top";
  return (
    <Card title="Marcador en vivo">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {([0, 1] as const).map((i) => {
          const side = state?.sides[i];
          const name = config.mode === "top" ? (side?.name ?? "—") : config.sides[i].name || (i ? "B" : "A");
          return (
            <div
              key={i}
              style={{ padding: 14, borderRadius: 12, background: "#0E0F12", border: `2px solid ${config.sides[i].color}`, minWidth: 0 }}
            >
              <div style={{ fontSize: 12, color: "#9A9CA5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {config.mode === "top" ? `TOP ${i + 1}` : name}
                {config.mode === "equipos" && side?.members !== undefined && ` · ${side.members} ${side.members === 1 ? "persona" : "personas"}`}
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {(side?.score ?? 0).toLocaleString("es")}
              </div>
              {config.mode === "top" && <div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>}
              {manual && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[-10, -1, 1, 10].map((d) => (
                    <Btn key={d} onClick={() => api.adjust(config.id, i, d)}>
                      {d > 0 ? `+${d}` : d}
                    </Btn>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={askReset}>{confirm ? "¿Seguro? Pulsa otra vez" : "Reiniciar marcador"}</Btn>
        <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          {config.mode === "top"
            ? "Reinicia el ranking de donadores de esta sesión."
            : config.mode === "equipos"
              ? "Pone los dos marcadores en 0 y vacía los equipos (cada quien vuelve a elegir)."
              : "Pone los dos marcadores en 0. Los botones +/− corrigen un error a mano."}
        </span>
      </div>
    </Card>
  );
}

/** Título, qué se cuenta y los datos de cada lado según el modo. */
function Settings({
  config,
  patch,
  patchSide,
}: {
  config: DuelConfig;
  patch: (p: Partial<DuelConfig>) => void;
  patchSide: (i: Side, p: Partial<DuelSideConfig>) => void;
}) {
  const metrics = DUEL_MODES.find((m) => m.id === config.mode)?.metrics ?? ["coins"];
  return (
    <Card title="Configuración">
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field label="Título" hint="se muestra sobre el duelo; déjalo vacío para no mostrarlo">
            <CommitInput value={config.title} max={60} onCommit={(v) => patch({ title: v })} />
          </Field>
        </div>
        <div style={{ width: 230 }}>
          <Field label="Qué se cuenta" hint="">
            {metrics.length > 1 ? (
              <select
                value={config.metric}
                onChange={(e) => patch({ metric: e.target.value as DuelMetric })}
                style={{ ...inputStyle, width: "100%" }}
              >
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {DUEL_METRIC_NAMES[m]}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ ...inputStyle, display: "flex", alignItems: "center", opacity: 0.7 }}>{DUEL_METRIC_NAMES[metrics[0]]}</div>
            )}
          </Field>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {([0, 1] as const).map((i) => {
          const side = config.sides[i];
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Lado {i === 0 ? "izquierdo" : "derecho"}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                {config.mode !== "top" && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="Nombre" hint="">
                      <CommitInput value={side.name} max={30} onCommit={(v) => patchSide(i, { name: v })} />
                    </Field>
                  </div>
                )}
                <Field label="Color" hint="">
                  <input
                    type="color"
                    value={side.color}
                    onChange={(e) => patchSide(i, { color: e.target.value })}
                    style={{ width: 44, height: 34, padding: 0, background: "none", border: "1px solid #2A2C33" }}
                  />
                </Field>
              </div>
              {config.mode === "regalos" && (
                <Field label="Regalos de este lado" hint="nombre o número, separados por comas (p. ej. Rose, 5655)">
                  <CommitInput value={side.gifts.join(", ")} onCommit={(v) => patchSide(i, { gifts: splitList(v) })} />
                </Field>
              )}
              {config.mode === "equipos" && (
                <Field label="Comandos para unirse" hint="separados por comas (p. ej. !azul, !blue)">
                  <CommitInput value={side.commands.join(", ")} onCommit={(v) => patchSide(i, { commands: splitList(v) })} />
                </Field>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
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
