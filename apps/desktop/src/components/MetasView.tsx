import {
  GOAL_METRICS,
  GOAL_PRESETS,
  GOAL_ROTATION_ID,
  GoalConfigSchema,
  goalPercent,
  type Goal,
  type GoalConfig,
} from "@streamtok/shared";
import { useEffect, useState } from "react";
import { useGoals } from "../lib/use-goals";
import type { SidecarClient } from "../lib/ws-client";
import { AccionesPicker, Btn, Card, DesignCard, Field, NumberField, UrlCard, cardStyle, grid3, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useGoals>;
const PRESET_IDS = new Set(GOAL_PRESETS.map((p) => p.id));

/**
 * Módulo "Metas": las metas ya vienen creadas (likes, seguidores, compartidos, monedas,
 * super fans, regalos). Cada una muestra su overlay y sus ajustes a la vista; arriba, las
 * "Metas rotativas" que van pasando de una en una.
 */
export function MetasView({ client }: { client: SidecarClient | null }) {
  const g = useGoals(client);
  const [creating, setCreating] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Metas</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Barras de progreso que avanzan con lo que pasa en el LIVE. Copia el enlace de la que quieras, o usa las rotativas para
          mostrar varias en el mismo sitio.
        </p>
      </div>

      {g.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{g.error}</div>}

      {!g.goals ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : (
        <>
          <RotationCard goals={g.goals} api={g} />
          {g.goals.map((goal) => (
            <GoalBlock key={goal.config.id} goal={goal} api={g} client={client} />
          ))}
          {creating ? (
            <GoalForm
              initial={undefined}
              takenIds={[...g.goals.map((x) => x.config.id), GOAL_ROTATION_ID]}
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
      )}
    </div>
  );
}

/** Qué metas entran en el overlay rotativo, con su enlace y vista previa. */
function RotationCard({ goals, api }: { goals: Goal[]; api: Api }) {
  return (
    <>
      <Card title="Metas rotativas">
        <div style={{ fontSize: 12, color: "#9A9CA5" }}>Marca las que quieres que vayan apareciendo, una cada 6 segundos.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {goals.map((goal) => (
            <label key={goal.config.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={goal.config.rotate}
                onChange={(e) => api.save({ ...goal.config, rotate: e.target.checked })}
              />
              {metricName(goal.config)}
            </label>
          ))}
        </div>
      </Card>
      <UrlCard kind="meta" id={GOAL_ROTATION_ID} title="Overlay de metas rotativas" />
    </>
  );
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
  useEffect(() => setTitle(config.title), [config.title]);
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
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="meta" id={config.id} style={config.style} onChange={(style) => api.save({ ...config, style })} />}
    </>
  );
}
