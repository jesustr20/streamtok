import {
  type Accion,
  type AccionesMessage,
  OVERLAY_DEFAULT_PORT,
  OVERLAY_DESIGNS,
  overlayPage,
  type OverlayKind,
  type OverlayStyle,
} from "@streamtok/shared";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SidecarClient } from "../lib/ws-client";

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
 * Enlaces del overlay (LIVE Studio y OBS). Con `onCustomize` muestra además la
 * vista previa (a su tamaño real, sin recortes) y el botón de personalizar.
 */
export function UrlCard({
  kind,
  id,
  title = "Enlace del overlay",
  onCustomize,
  customizeLabel = "Personalizar diseño",
  showPreview,
  stable = false,
  reserve,
}: {
  kind: OverlayKind;
  /** recuadro reservado de la vista previa (por defecto el del tipo) */
  reserve?: { w: number; h: number };
  /** instancia (solo overlays con varias, como las metas) */
  id?: string;
  title?: string;
  onCustomize?: () => void;
  customizeLabel?: string;
  /** vista previa aunque no haya botón de personalizar (p. ej. metas rotativas) */
  showPreview?: boolean;
  /** vista previa que espera a tener sus datos y reserva su recuadro (sin saltos de tamaño) */
  stable?: boolean;
}) {
  const path = id ? `/overlay/${kind}/${encodeURIComponent(id)}` : `/overlay/${kind}`;
  const server = useOverlayServerStatus();
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
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
      {(onCustomize || showPreview) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <Preview
            kind={kind}
            id={id}
            designId={undefined}
            maxWidth={560}
            onSize={setSize}
            reserve={reserve ?? (kind === "meta" || stable ? PREVIEW_RESERVE[kind] : undefined)}
            waitReady={stable}
            live={kind === "duelo" || kind === "top" || kind === "agente"}
          />
          {onCustomize && <Btn onClick={onCustomize}>{customizeLabel}</Btn>}
        </div>
      )}
      {(onCustomize || showPreview) && size && (
        <div style={{ fontSize: 12, color: "#9A9CA5", lineHeight: 1.5 }}>
          En TikTok LIVE Studio, si activas <b>Resolución personalizada</b>, usa al menos{" "}
          <b style={{ color: "#F4F4F5" }}>
            {roundUp(size.w)} × {roundUp(size.h)}
          </b>{" "}
          para que no se corte nada. Luego lo agrandas arrastrando las esquinas del cuadro en el lienzo.
        </div>
      )}
    </Card>
  );
}

/** Recuadro de vista previa reservado por tipo: no cambia de tamaño al cargar ni al volver a la vista. */
const PREVIEW_RESERVE: Record<OverlayKind, { w: number; h: number }> = {
  timer: { w: 490, h: 190 },
  wins: { w: 560, h: 150 },
  meta: { w: 560, h: 150 },
  nivel: { w: 560, h: 150 },
  duelo: { w: 560, h: 152 },
  top: { w: 440, h: 350 },
  agente: { w: 480, h: 440 },
};

/** Redondea hacia arriba al siguiente múltiplo de 10 (un poco de margen). */
function roundUp(n: number): number {
  return Math.ceil(n / 10) * 10 + 10;
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

/**
 * Elección de diseño (miniaturas), vista previa y personalización de colores.
 * El tamaño solo se puede cambiar en los overlays que lo admiten (Wins); el
 * timer tiene tamaño fijo y se agranda en TikTok LIVE Studio.
 */
export function DesignCard({
  kind,
  id,
  style,
  onChange,
  showPreview = true,
}: {
  kind: OverlayKind;
  id?: string;
  style: OverlayStyle;
  onChange: (s: OverlayStyle) => void;
  showPreview?: boolean;
  /** vista previa que espera a tener sus datos y reserva su recuadro (sin saltos de tamaño) */
  stable?: boolean;
}) {
  const designs = OVERLAY_DESIGNS[kind];
  const allowScale = kind !== "timer";
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
              <Preview kind={kind} id={id} designId={d.id} box={{ w: 212, h: 110 }} />
              <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>{d.name}</div>
            </button>
          );
        })}
      </div>

      {showPreview && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>Vista previa</div>
          <Preview kind={kind} id={id} designId={style.designId} maxWidth={920} />
        </>
      )}

      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>Personalizar</div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <ColorField label="Texto" value={style.textColor} onChange={(v) => onChange({ ...style, textColor: v })} />
        <ColorField label="Acento" value={style.accentColor} onChange={(v) => onChange({ ...style, accentColor: v })} />
        <ColorField label="Fondo" value={style.backgroundColor} onChange={(v) => onChange({ ...style, backgroundColor: v })} />
        {allowScale && (
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
        )}
      </div>
      {!allowScale && (
        <div style={{ fontSize: 12, color: "#9A9CA5" }}>
          El temporizador tiene un tamaño fijo: agrándalo o achícalo en TikTok LIVE Studio u OBS.
        </div>
      )}
    </Card>
  );
}

/**
 * Vista previa: la MISMA página que se sirve al stream, armada aquí mismo
 * (`srcDoc`) para no depender del servidor HTTP ni de la red local. Solo se
 * conecta por WebSocket al sidecar, igual que la app. Sin `designId` usa el
 * diseño elegido en la configuración.
 *
 * Mide el contenido real de la página y se ajusta a él: nunca se recorta, ni
 * con título y equivalencia, ni con otro tamaño. Con `box` (miniaturas) el
 * contenido se reduce para caber en ese cuadro fijo; sin `box` se muestra a su
 * tamaño real (reduciéndolo solo si no cabe en `maxWidth`).
 */
export function Preview({
  kind,
  id,
  designId,
  maxWidth = 920,
  box,
  onSize,
  reserve,
  waitReady = false,
  live = false,
}: {
  kind: OverlayKind;
  id?: string;
  designId: string | undefined;
  maxWidth?: number;
  box?: { w: number; h: number };
  /** tamaño mínimo reservado: el recuadro no cambia de tamaño al cargar ni entre diseños */
  reserve?: { w: number; h: number };
  /** no se muestra ni se mide hasta que la página recibe sus datos */
  waitReady?: boolean;
  /** muestra los datos reales (marcador en 0 incluido) en vez de números de ejemplo; para lo que el usuario está probando */
  live?: boolean;
  onSize?: (size: { w: number; h: number }) => void;
}) {
  const html = useMemo(
    () => overlayPage(kind, SIDECAR_WS_PORT, {
        ...(designId ? { design: designId } : {}),
        ...(id ? { id } : {}),
        ...(kind === "nivel" || ((kind === "duelo" || kind === "top" || kind === "agente") && !live) ? { demo: true } : {}),
      }),
    [kind, id, designId, live],
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => () => stopMeasuring(), []);

  function stopMeasuring() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  // El contenido cambia solo (hora, título, tamaño): se vuelve a medir cada 250 ms.
  function startMeasuring() {
    stopMeasuring();
    const measure = () => {
      const doc = frame.current?.contentDocument;
      // hasta que la página recibe sus datos tiene otro aspecto (vacía, sin texto): no se mide ni se muestra
      if (waitReady && !doc?.documentElement.hasAttribute("data-ready")) return;
      if (!doc) return;
      const root = doc.getElementById("root");
      if (!root) return;
      const r = root.getBoundingClientRect();
      const next = { w: Math.ceil(r.right), h: Math.ceil(r.bottom) };
      if (next.w <= 0 || next.h <= 0) return;
      setSize((prev) => {
        if (prev && prev.w === next.w && prev.h === next.h) return prev;
        onSizeRef.current?.(next);
        return next;
      });
    };
    measure();
    timer.current = setInterval(measure, 250);
  }

  const natural = size ?? { w: 1400, h: 600 }; // hasta medir, lienzo grande para que nada se corte
  const fit = size
    ? box
      ? Math.min(1, (box.w - 16) / size.w, (box.h - 16) / size.h)
      : Math.min(1, (maxWidth - 24) / size.w)
    : 1;
  // antes de medir se usa solo el tamaño reservado (el lienzo grande de medición está oculto)
  const outerW = box ? box.w : Math.max(reserve?.w ?? 0, size ? Math.round(natural.w * fit) + 24 : 0);
  const outerH = box ? box.h : Math.max(reserve?.h ?? 0, size ? Math.round(natural.h * fit) + 24 : 0);
  return (
    <div
      style={{
        width: size || reserve ? outerW : 120,
        maxWidth: "100%",
        height: size || reserve ? outerH : 60,
        overflow: "hidden",
        borderRadius: 8,
        background: "repeating-conic-gradient(#1b1c21 0% 25%, #23252c 0% 50%) 0 0 / 16px 16px",
        position: "relative",
        flexShrink: 0,
        display: "flex",
        alignItems: box ? "center" : "flex-start",
        justifyContent: box ? "center" : "flex-start",
        padding: box ? 0 : 12,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: Math.round(natural.w * fit),
          height: Math.round(natural.h * fit),
          position: "relative",
          flexShrink: 0,
          visibility: size ? "visible" : "hidden",
        }}
      >
        <iframe
          ref={frame}
          title={`preview-${kind}-${id ?? ""}-${designId ?? "actual"}`}
          srcDoc={html}
          onLoad={startMeasuring}
          style={{
            border: 0,
            position: "absolute",
            top: 0,
            left: 0,
            width: natural.w,
            height: natural.h,
            transform: `scale(${fit})`,
            transformOrigin: "top left",
            background: "transparent",
            pointerEvents: "none",
            colorScheme: "normal",
          }}
        />
      </div>
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

/** Elegir las Acciones que se ejecutan en un momento (al expirar el timer, al cumplir una meta…). */
export function AccionesPicker({
  label,
  client,
  ids,
  onChange,
}: {
  label: string;
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
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
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
