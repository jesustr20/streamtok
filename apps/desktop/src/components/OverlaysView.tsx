import {
  OVERLAY_DEFAULT_PORT,
  OVERLAY_DESIGNS,
  type Accion,
  type AccionesMessage,
  type OverlayKind,
  type OverlayStyle,
  type OverlaysMessage,
  type OverlaysConfig,
  type OverlaysState,
  type TimerConfig,
  type TimerPerType,
} from "@streamtok/shared";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { SidecarClient } from "../lib/ws-client";

const ACCENT = "#E23A57";
const LOCAL_HOST = `http://localhost:${OVERLAY_DEFAULT_PORT}`;
// TikTok LIVE Studio rechaza "localhost" y "127.0.0.1" como enlace; este nombre
// público resuelve a 127.0.0.1 y sí lo acepta (ADR 0011).
const LIVE_STUDIO_HOST = `http://127.0.0.1.nip.io:${OVERLAY_DEFAULT_PORT}`;

// ---------------------------------------------------------------------------
// Hook: estado y configuración de los overlays (canal `overlays`)
// ---------------------------------------------------------------------------

function useOverlays(client: SidecarClient | null) {
  const [state, setState] = useState<OverlaysState | null>(null);
  const [config, setConfig] = useState<OverlaysConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "overlays") return;
      const msg = evt.payload as OverlaysMessage;
      if (msg.kind === "state") {
        setState(msg.state);
        setConfig(msg.config);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("overlays", { kind: "get-state" });
    return off;
  }, [client]);

  const timerControl = useCallback(
    (op: string, seconds?: number) => client?.send("overlays", { kind: "timer-control", op, seconds }),
    [client],
  );
  const winsControl = useCallback(
    (op: string, value?: number | string) => client?.send("overlays", { kind: "wins-control", op, value }),
    [client],
  );
  const saveConfig = useCallback(
    (next: OverlaysConfig) => {
      setConfig(next); // optimista; el sidecar confirma con `state`
      client?.send("overlays", { kind: "set-config", config: next });
    },
    [client],
  );

  return { state, config, error, timerControl, winsControl, saveConfig };
}

// ---------------------------------------------------------------------------
// Vista principal
// ---------------------------------------------------------------------------

type Sub = "timer" | "wins";

const SUBS: { id: Sub; label: string; hint: string }[] = [
  { id: "timer", label: "Timer", hint: "Cuenta atrás que tus espectadores alargan" },
  { id: "wins", label: "Wins", hint: "Meta y conteo, p. ej. 2 / 6" },
];

export function OverlaysView({ client }: { client: SidecarClient | null }) {
  const [sub, setSub] = useState<Sub>("timer");
  const ov = useOverlays(client);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Overlays</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Elementos que se ven en tu stream. Pega el enlace como fuente en TikTok LIVE Studio u OBS.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {SUBS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            style={{
              ...cardStyle,
              cursor: "pointer",
              textAlign: "left",
              flex: 1,
              borderColor: sub === s.id ? ACCENT : "#2A2C33",
              color: "inherit",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: "#9A9CA5", marginTop: 3 }}>{s.hint}</div>
          </button>
        ))}
      </div>

      {!ov.config || !ov.state ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : (
        <>
          {ov.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{ov.error}</div>}
          {sub === "timer" ? (
            <TimerPage client={client} state={ov.state} config={ov.config} ov={ov} />
          ) : (
            <WinsPage state={ov.state} config={ov.config} ov={ov} />
          )}
        </>
      )}
    </div>
  );
}

type Ov = ReturnType<typeof useOverlays>;

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

function useRemaining(state: OverlaysState): number {
  const [now, setNow] = useState(() => Date.now());
  // Desfase entre el reloj del sidecar y el de esta ventana, fijado al recibir el estado.
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(state.serverNow - Date.now()), [state]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const t = state.timer;
  if (t.status === "running" && t.endsAt) return Math.max(0, t.endsAt - (now + offset));
  return t.remainingMs;
}

function fmtTime(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`;
}

const STATUS_LABEL = { idle: "Detenido", running: "Corriendo", paused: "En pausa", finished: "Terminado" } as const;

const PER_TYPE_FIELDS: { key: keyof TimerPerType; label: string; hint: string }[] = [
  { key: "coin", label: "Por moneda", hint: "segundos por cada moneda de un regalo" },
  { key: "subscribe", label: "Por suscripción", hint: "segundos por suscripción / Super Fan" },
  { key: "follow", label: "Por seguidor", hint: "segundos por cada nuevo seguidor" },
  { key: "share", label: "Por compartir", hint: "segundos por cada compartida" },
  { key: "like", label: "Por like", hint: "segundos por cada like (admite decimales, ej. 0.05)" },
  { key: "chat", label: "Por mensaje", hint: "segundos por cada mensaje de chat" },
];

function TimerPage({
  client,
  state,
  config,
  ov,
}: {
  client: SidecarClient | null;
  state: OverlaysState;
  config: OverlaysConfig;
  ov: Ov;
}) {
  const remaining = useRemaining(state);
  const [step, setStep] = useState(10);
  const tc = config.timer;
  const status = state.timer.status;

  function patchTimer(patch: Partial<TimerConfig>) {
    ov.saveConfig({ ...config, timer: { ...tc, ...patch } });
  }

  return (
    <>
      <UrlCard kind="timer" />

      <Card title="Control">
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div>
            <div
              style={{
                fontFamily: "Consolas, 'Courier New', monospace",
                fontSize: 44,
                fontWeight: 800,
                color: status === "finished" ? "#E5484D" : "#F4F4F5",
              }}
            >
              {fmtTime(remaining)}
            </div>
            <div style={{ fontSize: 12, color: "#9A9CA5" }}>{STATUS_LABEL[status]}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn primary onClick={() => ov.timerControl("start")}>
              {status === "paused" ? "Reanudar" : "Comenzar"}
            </Btn>
            <Btn onClick={() => ov.timerControl("pause")} disabled={status !== "running"}>
              Pausar
            </Btn>
            <Btn onClick={() => ov.timerControl("reset")}>Reiniciar</Btn>
            <Btn onClick={() => ov.timerControl("stop")}>Detener</Btn>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Btn onClick={() => ov.timerControl("add", -step)}>−</Btn>
            <NumberField value={step} min={1} width={64} onCommit={setStep} />
            <span style={{ fontSize: 12, color: "#9A9CA5" }}>s</span>
            <Btn onClick={() => ov.timerControl("add", step)}>+</Btn>
          </div>
        </div>
      </Card>

      <DesignCard kind="timer" style={config.timerStyle} onChange={(s) => ov.saveConfig({ ...config, timerStyle: s })} />

      <Card title="Configuración">
        <div style={grid2}>
          <Field label="Tiempo inicial (s)" hint="con lo que arranca al comenzar o reiniciar">
            <NumberField value={tc.startSeconds} min={1} onCommit={(v) => patchTimer({ startSeconds: v })} />
          </Field>
          <Field label="Tiempo máximo (s)" hint="0 = sin máximo">
            <NumberField value={tc.maxSeconds} min={0} onCommit={(v) => patchTimer({ maxSeconds: v })} />
          </Field>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={tc.rememberOnClose}
            onChange={(e) => patchTimer({ rememberOnClose: e.target.checked })}
          />
          Recordar el tiempo al cerrar la app (vuelve en pausa)
        </label>

        <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Segundos por interacción</div>
        <div style={grid3}>
          {PER_TYPE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <NumberField
                value={tc.perType[f.key]}
                decimals
                onCommit={(v) => patchTimer({ perType: { ...tc.perType, [f.key]: v } })}
              />
            </Field>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={tc.multiplier.active}
              onChange={(e) => patchTimer({ multiplier: { ...tc.multiplier, active: e.target.checked } })}
            />
            Multiplicador ×
          </label>
          <NumberField
            value={tc.multiplier.value}
            min={0.1}
            decimals
            width={70}
            onCommit={(v) => patchTimer({ multiplier: { ...tc.multiplier, value: v } })}
          />
          <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>multiplica todos los segundos de arriba</span>
        </div>
        <div style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          Los espectadores solo suman mientras el timer está corriendo.
        </div>

        <ExpireActions client={client} ids={tc.onExpireAccionIds} onChange={(ids) => patchTimer({ onExpireAccionIds: ids })} />
      </Card>
    </>
  );
}

/** Acciones que se ejecutan cuando el timer llega a 0. */
function ExpireActions({
  client,
  ids,
  onChange,
}: {
  client: SidecarClient | null;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const [acciones, setAcciones] = useState<Accion[]>([]);
  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel === "acciones") {
        const msg = evt.payload as AccionesMessage;
        if (msg.kind === "update") setAcciones(msg.acciones);
      }
    });
    client.send("profiles", { kind: "get-state" });
    return off;
  }, [client]);

  const available = acciones.filter((a) => !ids.includes(a.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>Al expirar, ejecutar</div>
      {ids.length === 0 && <div style={{ fontSize: 12, color: "#9A9CA5" }}>Ninguna acción.</div>}
      {ids.map((id) => {
        const a = acciones.find((x) => x.id === id);
        return (
          <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ flex: 1 }}>{a ? a.nombre : "(acción eliminada)"}</span>
            <Btn onClick={() => onChange(ids.filter((x) => x !== id))}>Quitar</Btn>
          </div>
        );
      })}
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
        disabled={available.length === 0}
        style={{ ...inputStyle, width: 260 }}
      >
        <option value="">{available.length === 0 ? "No hay más acciones" : "Agregar acción…"}</option>
        {available.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wins
// ---------------------------------------------------------------------------

function WinsPage({ state, config, ov }: { state: OverlaysState; config: OverlaysConfig; ov: Ov }) {
  const w = state.wins;
  const [title, setTitle] = useState(w.title);
  useEffect(() => setTitle(w.title), [w.title]);

  return (
    <>
      <UrlCard kind="wins" />

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
            <Btn onClick={() => ov.winsControl("reset")}>Reiniciar</Btn>
          </div>
        </div>
        <div style={grid3}>
          <Field label="Conteo" hint="cuántos van">
            <NumberField value={w.count} min={0} integer onCommit={(v) => ov.winsControl("set", v)} />
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
          También puedes sumar wins desde un Evento con el comando “Wins: sumar/restar”.
        </div>
      </Card>

      <DesignCard kind="wins" style={config.winsStyle} onChange={(s) => ov.saveConfig({ ...config, winsStyle: s })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function UrlCard({ kind }: { kind: OverlayKind }) {
  const path = `/overlay/${kind}`;
  return (
    <Card title="Enlace del overlay">
      <UrlRow label="TikTok LIVE Studio" url={`${LIVE_STUDIO_HOST}${path}`} note="usa este nombre porque LIVE Studio rechaza localhost; necesita internet" />
      <UrlRow label="OBS / navegador" url={`${LOCAL_HOST}${path}`} note="no necesita internet" />
    </Card>
  );
}

function UrlRow({ label, url, note }: { label: string; url: string; note: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11.5, color: "#9A9CA5" }}>
        <b style={{ color: "#F4F4F5" }}>{label}</b> · {note}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <code style={{ ...inputStyle, flex: 1, display: "flex", alignItems: "center", userSelect: "all" }}>{url}</code>
        <Btn primary onClick={copy}>
          {copied ? "Copiado" : "Copiar"}
        </Btn>
        <a href={url} target="_blank" rel="noreferrer" style={{ ...btnStyle, textDecoration: "none" }}>
          Probar
        </a>
      </div>
    </div>
  );
}

function DesignCard({
  kind,
  style,
  onChange,
}: {
  kind: OverlayKind;
  style: OverlayStyle;
  onChange: (s: OverlayStyle) => void;
}) {
  const designs = OVERLAY_DESIGNS[kind];
  return (
    <Card title="Diseño">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {designs.map((d) => {
          const selected = style.designId === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onChange({ ...style, designId: d.id })}
              style={{
                width: 230,
                padding: 8,
                borderRadius: 12,
                background: "#0E0F12",
                border: `2px solid ${selected ? ACCENT : "#2A2C33"}`,
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Preview kind={kind} designId={d.id} width={212} height={96} scale={0.3} />
              <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>{d.name}</div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>Vista previa</div>
      <Preview kind={kind} designId={style.designId} width={920} height={220} scale={1} live />

      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>Personalizar</div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <ColorField label="Texto" value={style.textColor} onChange={(v) => onChange({ ...style, textColor: v })} />
        <ColorField label="Acento" value={style.accentColor} onChange={(v) => onChange({ ...style, accentColor: v })} />
        <ColorField label="Fondo" value={style.backgroundColor} onChange={(v) => onChange({ ...style, backgroundColor: v })} />
        <Field label={`Tamaño ×${style.scale}`} hint="">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={style.scale}
            onChange={(e) => onChange({ ...style, scale: Number(e.target.value) })}
          />
        </Field>
      </div>
    </Card>
  );
}

/** Iframe del overlay real (misma página que va al stream), escalado y sobre damero. */
function Preview({
  kind,
  designId,
  width,
  height,
  scale,
  live,
}: {
  kind: OverlayKind;
  designId: string;
  width: number;
  height: number;
  scale: number;
  live?: boolean;
}) {
  const src = `${LOCAL_HOST}/overlay/${kind}${live ? "" : `?design=${designId}`}`;
  return (
    <div
      style={{
        width,
        maxWidth: "100%",
        height,
        overflow: "hidden",
        borderRadius: 8,
        background: "repeating-conic-gradient(#1b1c21 0% 25%, #23252c 0% 50%) 0 0 / 16px 16px",
        position: "relative",
      }}
    >
      <iframe
        title={`${kind}-${designId}`}
        src={src}
        style={{
          border: 0,
          width: width / scale,
          height: height / scale,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: "transparent",
          pointerEvents: "none",
          colorScheme: "normal",
        }}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label} hint="">
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 28, padding: 0, background: "none", border: "1px solid #2A2C33" }}
        />
        <Btn onClick={() => onChange(undefined)} disabled={!value}>
          Por defecto
        </Btn>
      </div>
    </Field>
  );
}

/** Campo numérico con texto local: se confirma al salir del campo o con Enter. */
function NumberField({
  value,
  onCommit,
  min,
  width,
  decimals,
  integer,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  width?: number;
  decimals?: boolean;
  integer?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit() {
    let n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || text.trim() === "") {
      setText(String(value));
      return;
    }
    if (integer || !decimals) n = Math.round(n);
    if (min !== undefined && n < min) n = min;
    setText(String(n));
    if (n !== value) onCommit(n);
  }
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, width: width ?? "100%" }}
    />
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: "#7C7E88" }}>{hint}</span>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h2>
      {children}
    </section>
  );
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...btnStyle,
        background: primary ? ACCENT : "#23252C",
        borderColor: primary ? ACCENT : "#2A2C33",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

const cardStyle: CSSProperties = {
  padding: 18,
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 14,
  boxSizing: "border-box",
};

const btnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid #2A2C33",
  color: "#F4F4F5",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  height: 34,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 12.5,
  minWidth: 0,
};

const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
const grid3: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 };
