import { ALERT_KINDS, type AlertConfig, type AlertKind } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { useAlertas } from "../lib/use-alertas";
import { useTestRunner } from "../lib/use-test-runner";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, DesignCard, Field, NumberField, UrlCard, cardStyle, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useAlertas>;

/** Recuadro de la vista previa según el diseño (los animados necesitan sitio para las chispas). */
const RESERVE: Record<string, { w: number; h: number }> = {
  tarjeta: { w: 560, h: 300 },
  anillo: { w: 560, h: 440 },
  celebracion: { w: 560, h: 230 },
};

/** Qué hace cada alerta de fábrica, para explicarlo en pantalla. */
const INTRO: Record<string, string> = {
  comunidad: "Avisa cuando alguien se une a tu comunidad (con el regalo Quiéreme / Heart Me) y cuando un miembro sube de nivel de fan.",
  donador: "Avisa cuando un espectador sube de nivel de donador, con su foto y el nivel que alcanzó.",
  todas: "Un solo overlay con todos los avisos: nuevos miembros, nivel de fan y nivel de donador, uno tras otro.",
};

/** Módulo "Alertas y efectos → Subida de nivel": una pantalla por alerta, ya creada y con su vista previa. */
export function AlertasView({ client, selected }: { client: SidecarClient | null; selected: string }) {
  const api = useAlertas(client);
  const config = api.configs?.find((c) => c.id === selected);
  const heading = config ? `Alertas · ${config.title || config.id}` : "Alertas";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>{heading}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Avisos en pantalla con la foto del usuario. Elige la alerta en el menú de la izquierda.
        </p>
      </div>
      {api.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{api.error}</div>}
      {!api.configs ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : config ? (
        <AlertBlock key={config.id} config={config} api={api} />
      ) : (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Esta alerta no existe.</div>
      )}
    </div>
  );
}

function AlertBlock({ config, api }: { config: AlertConfig; api: Api }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<AlertConfig>) => api.save({ ...config, ...p });
  const toggleKind = (k: AlertKind, on: boolean) => {
    const kinds = on ? [...config.kinds, k] : config.kinds.filter((x) => x !== k);
    patch({ kinds: ALERT_KINDS.map((a) => a.id).filter((id) => kinds.includes(id)) });
  };
  const usesJoin = config.kinds.includes("fanJoin");
  const designId = config.style.designId;
  // Test: lanza avisos de ejemplo de los tipos activados, uno tras otro (esperando a que termine el anterior).
  const TEST_MAX = 10;
  const { running, count, start, stop } = useTestRunner((n) => {
    const on = config.kinds;
    if (on.length === 0) return null;
    api.test(on[Math.floor(Math.random() * on.length)]);
    return n + 1 >= TEST_MAX ? null : config.durationSec * 1000 + 800 + Math.random() * 1200;
  });
  useEffect(() => stop, [config.id, stop]);

  return (
    <>
      <Card title="Qué avisa">
        {INTRO[config.id] && <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>{INTRO[config.id]}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ALERT_KINDS.map((k) => {
            const on = config.kinds.includes(k.id);
            return (
              <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, width: 230, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={(e) => toggleKind(k.id, e.target.checked)} />
                  {k.name}
                </label>
                <TextInput
                  disabled={!on}
                  value={config.texts[k.id]}
                  onCommit={(v) => patch({ texts: { ...config.texts, [k.id]: v || k.defaultText } })}
                />
                <Btn onClick={() => api.test(k.id)}>Probar</Btn>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          En la frase, <b>{"{nombre}"}</b> se cambia por el nombre del usuario y <b>{"{nivel}"}</b> por su nivel. “Probar” lanza un aviso de
          ejemplo a todos los overlays de alertas que lo muestren.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Btn onClick={running ? stop : start} disabled={!running && config.kinds.length === 0}>
            {running ? `■ Detener (${count}/${TEST_MAX})` : "▶ Iniciar test"}
          </Btn>
          <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>Lanza avisos de ejemplo al azar con los tipos marcados.</span>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 150 }}>
            <Field label="Segundos en pantalla" hint="">
              <NumberField value={config.durationSec} min={2} onCommit={(v) => patch({ durationSec: Math.min(30, v) })} />
            </Field>
          </div>
          <div style={{ width: 150 }}>
            <Field label="Nivel mínimo" hint="1 = todas las subidas">
              <NumberField value={config.minLevel} min={1} integer onCommit={(v) => patch({ minLevel: Math.min(100, v) })} />
            </Field>
          </div>
        </div>
      </Card>

      {usesJoin && <JoinGiftCard names={api.joinGiftNames} onSave={api.setJoinGifts} />}

      <UrlCard
        kind="nivel"
        id={config.id}
        title="Overlay"
        stable
        reserve={RESERVE[designId] ?? { w: 560, h: 150 }}
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="nivel" id={config.id} style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

/** Con qué regalo se une la gente a la comunidad (en TikTok es "Heart Me" / Quiéreme). */
function JoinGiftCard({ names, onSave }: { names: string[]; onSave: (names: string[]) => void }) {
  const [text, setText] = useState(names.join(", "));
  useEffect(() => setText(names.join(", ")), [names]);
  const commit = () => {
    const next = text.split(",").map((n) => n.trim()).filter(Boolean);
    if (next.join("|").toLowerCase() !== names.join("|").toLowerCase()) onSave(next);
  };
  return (
    <Card title="Cómo se detecta que alguien se une">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.5 }}>
        TikTok no manda un aviso de “nuevo miembro”: se detecta por el regalo con el que se entra a la comunidad. Si en tu cuenta se llama
        distinto, escribe su nombre tal como sale en los regalos (separa varios con comas). Cada usuario avisa una sola vez por LIVE.
      </div>
      <Field label="Nombres del regalo" hint="sin importar mayúsculas">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          style={inputStyle}
        />
      </Field>
    </Card>
  );
}

function TextInput({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      maxLength={120}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, flex: 1, minWidth: 260, opacity: disabled ? 0.5 : 1 }}
    />
  );
}
