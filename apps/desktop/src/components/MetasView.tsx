import {
  GOAL_METRICS,
  GOAL_PRESETS,
  GOAL_ROTATION_ID,
  GoalConfigSchema,
  goalPercent,
  type Goal,
  type GoalConfig,
} from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useGoals } from "../lib/use-goals";
import { useTestRunner } from "../lib/use-test-runner";
import type { SidecarClient } from "../lib/ws-client";
import { AccionesPicker, Btn, Card, DesignCard, Field, NumberField, UrlCard, cardStyle, grid3, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useGoals>;
const PRESET_IDS = new Set(GOAL_PRESETS.map((p) => p.id));

const TEST_LIMIT = 0.95;

/** Paso al azar del test: entre el 1,5 % y el 6 % de la meta. */
function randomStep(target: number): number {
  const lo = Math.max(1, Math.round(target * 0.015));
  const hi = Math.max(lo, Math.round(target * 0.06));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * "Iniciar test": sube la meta poco a poco con pasos al azar (como si llegaran likes, regalos…) hasta que
 * la detengas. Se para sola al 95 %: así nunca llega a cumplirse la meta ni se disparan sus "Acciones al
 * finalizar". Al detenerlo, la meta se queda donde estaba.
 */
function GoalTestRunner({ id, current, target, api }: { id: string; current: number; target: number; api: Api }) {
  const acc = useRef(current);
  const limit = Math.floor(target * TEST_LIMIT);
  const { running, start, stop } = useTestRunner(() => {
    const step = Math.min(randomStep(target), limit - acc.current);
    if (step < 1) return null;
    api.control(id, "add", step);
    acc.current += step;
    return acc.current >= limit ? null : 350 + Math.random() * 850;
  });
  // si cambias de meta, no debe seguir sumando; si la reinicias o la bajas a mano a mitad del test, también se detiene
  useEffect(() => stop, [id, stop]);
  const prev = useRef(current);
  useEffect(() => {
    if (running && current < prev.current) stop();
    prev.current = current;
  }, [current, running, stop]);

  return (
    <Btn
      onClick={() => {
        if (running) return stop();
        acc.current = current;
        start();
      }}
      disabled={!running && current >= limit}
    >
      {running ? "■ Detener" : "▶ Iniciar test"}
    </Btn>
  );
}

/** Metas rotativas: el mismo test, repartido al azar entre las metas del ciclo; y reiniciarlas todas. */
function RotationTest({ goals, api }: { goals: Goal[]; api: Api }) {
  const active = goals.filter((g) => g.config.rotate);
  const [confirm, setConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (confirmTimer.current && clearTimeout(confirmTimer.current)), []);
  const open = (g: Goal) => g.state.current < Math.floor(g.config.target * TEST_LIMIT);
  const { running, start, stop } = useTestRunner(() => {
    const eligible = active.filter(open);
    if (eligible.length === 0) return null;
    const g = eligible[Math.floor(Math.random() * eligible.length)];
    const step = Math.min(randomStep(g.config.target), Math.floor(g.config.target * TEST_LIMIT) - g.state.current);
    if (step >= 1) api.control(g.config.id, "add", step);
    return eligible.length === 1 && step >= Math.floor(g.config.target * TEST_LIMIT) - g.state.current ? null : 350 + Math.random() * 850;
  });
  const resetAll = () => {
    if (!confirm) {
      setConfirm(true);
      confirmTimer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirm(false);
    stop();
    for (const g of active) api.control(g.config.id, "reset");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Btn onClick={running ? stop : start} disabled={!running && !active.some(open)}>
        {running ? "■ Detener" : "▶ Iniciar test"}
      </Btn>
      <Btn onClick={resetAll} disabled={active.length === 0}>
        {confirm ? "¿Seguro? Pulsa otra vez" : "Reiniciar metas del ciclo"}
      </Btn>
      <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>
        El test sube las metas del ciclo al azar y se para al 95 % (no las cumple). Reiniciar las pone en 0.
      </span>
    </div>
  );
}

/**
 * Módulo "Metas": las metas ya vienen creadas (likes, seguidores, compartidos, monedas,
 * super fans, regalos). Cada una muestra su overlay y sus ajustes a la vista; arriba, las
 * "Metas rotativas" que van pasando de una en una.
 */
export function MetasView({ client, selected }: { client: SidecarClient | null; selected: string }) {
  const g = useGoals(client);
  const [creating, setCreating] = useState(false);
  const goals = g.goals ?? [];
  const custom = goals.filter((x) => !PRESET_IDS.has(x.config.id));
  const shown = goals.filter((x) => x.config.id === selected);
  const heading =
    selected === GOAL_ROTATION_ID ? "Metas rotativas" : selected === "personalizadas" ? "Metas personalizadas" : shown[0] ? metricName(shown[0].config) : "Metas";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>{heading}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Barras de progreso que avanzan con lo que pasa en el LIVE. Elige la meta en el menú de la izquierda.
        </p>
      </div>

      {g.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{g.error}</div>}

      {!g.goals ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : selected === GOAL_ROTATION_ID ? (
        <RotationCard goals={g.goals} api={g} />
      ) : selected === "personalizadas" ? (
        <>
          {custom.length === 0 && !creating && (
            <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>
              Aún no tienes metas personalizadas. Sirven para algo que las de fábrica no cubren, por ejemplo likes de un regalo concreto.
            </div>
          )}
          {custom.map((goal) => (
            <GoalBlock key={goal.config.id} goal={goal} api={g} client={client} />
          ))}
          {creating ? (
            <GoalForm
              initial={undefined}
              takenIds={[...goals.map((x) => x.config.id), GOAL_ROTATION_ID, "personalizadas"]}
              onCancel={() => setCreating(false)}
              onSave={(c) => {
                g.save(c);
                setCreating(false);
              }}
            />
          ) : (
            <div>
              <Btn onClick={() => setCreating(true)}>Añadir meta personalizada</Btn>
            </div>
          )}
        </>
      ) : shown.length > 0 ? (
        <GoalBlock key={shown[0].config.id} goal={shown[0]} api={g} client={client} />
      ) : (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>
          Esta meta ya no existe (la borraste). Puedes crear otra en “Personalizadas”.
        </div>
      )}
    </div>
  );
}

/** Qué metas entran en el overlay rotativo, con su enlace y vista previa. */
function RotationCard({ goals, api }: { goals: Goal[]; api: Api }) {
  const active = goals.filter((g) => g.config.rotate);
  return (
    <>
      <Card title="¿Qué es una meta rotativa?">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          Es <b>un solo overlay</b> (un solo enlace) que va mostrando tus metas <b>una por una</b>, cada 6 segundos, en bucle.
          Así ocupas el espacio de una sola barra en pantalla en vez de poner varias. Cada meta se ve con su propio diseño y
          avanza igual que si la tuvieras suelta; aquí solo eliges cuáles entran en el ciclo.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          {active.length === 0 ? (
            <span style={{ color: "#9A9CA5" }}>No hay ninguna marcada: el overlay saldrá vacío.</span>
          ) : (
            <>
              {active.map((goal, i) => (
                <span key={goal.config.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ padding: "4px 10px", borderRadius: 999, background: "#23252C", color: "#F4F4F5", fontWeight: 600 }}>
                    {goalLabel(goal.config)}
                  </span>
                  {i < active.length - 1 && <span style={{ color: "#5B5D66" }}>6 s →</span>}
                </span>
              ))}
              {active.length > 1 && <span style={{ color: "#5B5D66" }}>6 s ↻ vuelve a la primera</span>}
            </>
          )}
        </div>
      </Card>
      <Card title="Metas del ciclo">
        <div style={{ fontSize: 12, color: "#9A9CA5" }}>Marca las que quieres que vayan apareciendo.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {goals.map((goal) => (
            <label key={goal.config.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={goal.config.rotate}
                onChange={(e) => api.save({ ...goal.config, rotate: e.target.checked })}
              />
              {goalLabel(goal.config)}
            </label>
          ))}
        </div>
        <RotationTest goals={goals} api={api} />
      </Card>
      <UrlCard kind="meta" id={GOAL_ROTATION_ID} title="Overlay de metas rotativas" showPreview stable />
    </>
  );
}

/** Nombre para listas: el título de la meta (o su tipo si no tiene), marcando las propias. */
function goalLabel(c: GoalConfig): string {
  const base = c.title.trim() || metricName(c);
  return PRESET_IDS.has(c.id) ? base : `${base} (propia)`;
}

function metricName(c: GoalConfig): string {
  return GOAL_METRICS.find((m) => m.id === c.metric)?.name ?? c.metric;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function GoalForm({
  initial,
  takenIds,
  onSave,
  onCancel,
}: {
  initial: GoalConfig | undefined;
  takenIds: string[];
  onSave: (c: GoalConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GoalConfig>(() => initial ?? GoalConfigSchema.parse({ id: "meta", title: "" }));
  const [giftText, setGiftText] = useState(draft.giftId ? String(draft.giftId) : "");
  const [error, setError] = useState<string | null>(null);
  const editing = !!initial;
  const usesGift = draft.metric === "coins" || draft.metric === "gifts";

  function submit() {
    let id = draft.id;
    if (!editing) {
      const base = slugify(draft.title) || "meta";
      id = base;
      for (let n = 2; takenIds.includes(id); n++) id = `${base}-${n}`;
    }
    const giftId = usesGift && giftText.trim() !== "" ? Number(giftText) : undefined;
    const parsed = GoalConfigSchema.safeParse({ ...draft, id, giftId });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    onSave(parsed.data);
  }

  return (
    <Card title={editing ? "Editar meta" : "Nueva meta"}>
      <div style={grid3}>
        <Field label="Título" hint="lo muestra el diseño">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Meta de likes"
            style={inputStyle}
          />
        </Field>
        <Field label="Qué cuenta" hint="">
          <select
            value={draft.metric}
            onChange={(e) => setDraft({ ...draft, metric: e.target.value as GoalConfig["metric"] })}
            style={inputStyle}
          >
            {GOAL_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Objetivo" hint="cuánto hay que llegar a juntar">
          <NumberField value={draft.target} min={1} integer onCommit={(v) => setDraft({ ...draft, target: v })} />
        </Field>
        {usesGift && (
          <Field label="Solo este regalo (id)" hint="vacío = cualquier regalo">
            <input value={giftText} onChange={(e) => setGiftText(e.target.value)} inputMode="numeric" style={inputStyle} />
          </Field>
        )}
        <Field label="Al cumplirse" hint="">
          <select
            value={draft.onReach}
            onChange={(e) => setDraft({ ...draft, onReach: e.target.value as GoalConfig["onReach"] })}
            style={inputStyle}
          >
            <option value="stay">Quedarse llena</option>
            <option value="grow">Subir el objetivo</option>
            <option value="reset">Reiniciar a 0</option>
          </select>
        </Field>
        {draft.onReach === "grow" && (
          <Field label="Subir en" hint="se suma al objetivo cada vez">
            <NumberField value={draft.step} min={1} integer onCommit={(v) => setDraft({ ...draft, step: v })} />
          </Field>
        )}
      </div>
      {error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn primary onClick={submit}>
          {editing ? "Guardar" : "Crear meta"}
        </Btn>
        <Btn onClick={onCancel}>Cancelar</Btn>
      </div>
    </Card>
  );
}

function GoalBlock({ goal, api, client }: { goal: Goal; api: Api; client: SidecarClient | null }) {
  const { config, state } = goal;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(config.title);
  const [giftText, setGiftText] = useState(config.giftId ? String(config.giftId) : "");
  const [before, setBefore] = useState(config.textBefore);
  const [after, setAfter] = useState(config.textAfter);
  useEffect(() => setTitle(config.title), [config.title]);
  useEffect(() => setBefore(config.textBefore), [config.textBefore]);
  useEffect(() => setAfter(config.textAfter), [config.textAfter]);
  useEffect(() => setGiftText(config.giftId ? String(config.giftId) : ""), [config.giftId]);
  const patch = (p: Partial<GoalConfig>) => api.save({ ...config, ...p });
  const usesGift = config.metric === "coins" || config.metric === "gifts";
  const pct = Math.floor(goalPercent(state.current, state.target));
  const unit = GOAL_METRICS.find((m) => m.id === config.metric)?.unit ?? "";
  const isPreset = PRESET_IDS.has(config.id);

  return (
    <>
      <Card title={metricName(config).toUpperCase()}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
          <div style={{ width: 120 }}>
            <Field label="Meta" hint="">
              <NumberField value={config.target} min={1} integer onCommit={(v) => patch({ target: v })} />
            </Field>
          </div>
          <div style={{ width: 220 }}>
            <Field label="Título" hint="">
              <input
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title !== config.title && patch({ title })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ width: 170 }}>
            <Field label="Cuando se alcanza" hint="">
              <select value={config.onReach} onChange={(e) => patch({ onReach: e.target.value as GoalConfig["onReach"] })} style={inputStyle}>
                <option value="grow">Aumentar meta</option>
                <option value="stay">Mantener</option>
                <option value="reset">Reiniciar a 0</option>
              </select>
            </Field>
          </div>
          {config.onReach === "grow" && (
            <div style={{ width: 110 }}>
              <Field label="Aumentar en" hint="">
                <NumberField value={config.step} min={1} integer onCommit={(v) => patch({ step: v })} />
              </Field>
            </div>
          )}
          <div style={{ width: 150 }}>
            <Field label="Muestra" hint="">
              <select value={config.countdown ? "down" : "up"} onChange={(e) => patch({ countdown: e.target.value === "down" })} style={inputStyle}>
                <option value="up">Avance (%)</option>
                <option value="down">Cuenta atrás (Quedan N)</option>
              </select>
            </Field>
          </div>
          {usesGift && (
            <div style={{ width: 150 }}>
              <Field label="Solo este regalo (id)" hint="">
                <input
                  value={giftText}
                  inputMode="numeric"
                  placeholder="cualquiera"
                  onChange={(e) => setGiftText(e.target.value)}
                  onBlur={() => {
                    const n = giftText.trim() === "" ? undefined : Math.round(Number(giftText));
                    if (n !== undefined && (!Number.isFinite(n) || n <= 0)) return setGiftText(config.giftId ? String(config.giftId) : "");
                    if (n !== config.giftId) patch({ giftId: n });
                  }}
                  style={inputStyle}
                />
              </Field>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
          <div style={{ width: 230 }}>
            <Field label="Texto antes del número" hint="diseño Texto, p. ej. “Hay ”">
              <input value={before} maxLength={60} onChange={(e) => setBefore(e.target.value)} onBlur={() => before !== config.textBefore && patch({ textBefore: before })} style={inputStyle} />
            </Field>
          </div>
          <div style={{ width: 230 }}>
            <Field label="Texto después del número" hint="p. ej. “ likes por conseguir”">
              <input value={after} maxLength={60} onChange={(e) => setAfter(e.target.value)} onBlur={() => after !== config.textAfter && patch({ textAfter: after })} style={inputStyle} />
            </Field>
          </div>
        </div>

        <AccionesPicker label="Acciones al finalizar" client={client} ids={config.onReachAccionIds} onChange={(ids) => patch({ onReachAccionIds: ids })} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {state.current} <span style={{ color: "#5B5D66" }}>/</span> {state.target}
            <span style={{ fontSize: 12.5, color: "#9A9CA5", fontWeight: 500, marginLeft: 8 }}>
              {pct}% · {unit}
              {state.reached > 0 ? ` · cumplida ${state.reached}×` : ""}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
            <Btn onClick={() => api.control(config.id, "add", -1)}>− 1</Btn>
            <Btn onClick={() => api.control(config.id, "add", 1)}>+ 1</Btn>
            <GoalTestRunner id={config.id} current={state.current} target={state.target} api={api} />
            <Btn primary onClick={() => api.control(config.id, "add", Math.max(1, Math.round(state.target * 0.1)))}>
              Testear (+10 %)
            </Btn>
            <Btn onClick={() => api.control(config.id, "reset")}>Reiniciar</Btn>
            {!isPreset && (
              <Btn
                onClick={() => {
                  if (window.confirm(`¿Borrar la meta “${config.title || config.id}”? Su enlace dejará de mostrar nada.`)) api.remove(config.id);
                }}
              >
                Borrar
              </Btn>
            )}
          </div>
        </div>
      </Card>
      <UrlCard
        kind="meta"
        id={config.id}
        title="Overlay"
        stable={!isPreset}
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="meta" id={config.id} style={config.style} onChange={(style) => api.save({ ...config, style })} />}
    </>
  );
}
