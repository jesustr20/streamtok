import {
  OVERLAY_DEFAULT_PORT,
  OVERLAY_DESIGNS,
  overlayPage,
  type OverlayKind,
  type OverlayStyle,
} from "@streamtok/shared";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

export const ACCENT = "#E23A57";
export const LOCAL_HOST = `http://localhost:${OVERLAY_DEFAULT_PORT}`;
// TikTok LIVE Studio rechaza "localhost" y "127.0.0.1" como enlace; este nombre
// público resuelve a 127.0.0.1 y sí lo acepta (ADR 0011).
export const LIVE_STUDIO_HOST = `http://127.0.0.1.nip.io:${OVERLAY_DEFAULT_PORT}`;
/** Puerto del WebSocket del sidecar al que se conectan los overlays. */
const SIDECAR_WS_PORT = 7331;

/** ¿Responde el servidor de overlays del sidecar? (otro programa puede tener el puerto) */
function useOverlayServerStatus(): "checking" | "up" | "down" {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    fetch(`${LOCAL_HOST}/overlay/timer`, { mode: "no-cors", signal: ctrl.signal })
      .then(() => alive && setStatus("up"))
      .catch(() => alive && setStatus("down"))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);
  return status;
}

/**
 * Enlaces del overlay (LIVE Studio y OBS). Con `showPreview` muestra además la
 * vista previa y el botón "Personalizar" que lleva a la sección Overlays.
 */
export function UrlCard({
  kind,
  title = "Enlace del overlay",
  onCustomize,
}: {
  kind: OverlayKind;
  title?: string;
  onCustomize?: () => void;
}) {
  const path = `/overlay/${kind}`;
  const server = useOverlayServerStatus();
  return (
    <Card title={title}>
      <UrlRow
        label="TikTok LIVE Studio"
        url={`${LIVE_STUDIO_HOST}${path}`}
        note="usa este nombre porque LIVE Studio rechaza localhost; necesita internet"
      />
      <UrlRow label="OBS / navegador" url={`${LOCAL_HOST}${path}`} note="no necesita internet" />
      {server === "down" && (
        <div style={{ fontSize: 12, color: "#F5A524" }}>
          No se pudo comprobar el servidor de overlays en el puerto {OVERLAY_DEFAULT_PORT}. Revisa la consola del
          sidecar: si dice “no se pudo abrir el servidor de overlays”, otro programa usa ese puerto.
        </div>
      )}
      {onCustomize && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Preview kind={kind} designId={undefined} width={420} height={130} scale={0.5} />
          <Btn onClick={onCustomize}>Personalizar diseño</Btn>
        </div>
      )}
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

/** Elección de diseño (miniaturas), vista previa y personalización de colores/tamaño. */
export function DesignCard({
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
      <Preview kind={kind} designId={style.designId} width={920} height={220} scale={1} />

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

/**
 * Vista previa: la MISMA página que se sirve al stream, armada aquí mismo
 * (`srcDoc`) para no depender del servidor HTTP ni de la red local. Solo se
 * conecta por WebSocket al sidecar, igual que la app. Sin `designId` usa el
 * diseño elegido en la configuración.
 */
export function Preview({
  kind,
  designId,
  width,
  height,
  scale,
}: {
  kind: OverlayKind;
  designId: string | undefined;
  width: number;
  height: number;
  scale: number;
}) {
  const html = useMemo(
    () => overlayPage(kind, SIDECAR_WS_PORT, designId ? { design: designId } : {}),
    [kind, designId],
  );
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
        flexShrink: 0,
      }}
    >
      <iframe
        title={`preview-${kind}-${designId ?? "actual"}`}
        srcDoc={html}
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

export function ColorField({
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
export function NumberField({
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

export function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: "#7C7E88" }}>{hint}</span>}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h2>
      {children}
    </section>
  );
}

export function Btn({
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

export const cardStyle: CSSProperties = {
  padding: 18,
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 14,
  boxSizing: "border-box",
};

export const btnStyle: CSSProperties = {
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

export const inputStyle: CSSProperties = {
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

export const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };
export const grid3: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 };
