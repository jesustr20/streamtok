import { formatTimerMs, timerRateText, type OverlaysConfig, type OverlaysState, type TimerConfig, type TimerPerType } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { useOverlays, type Ov } from "../lib/use-overlays";
import type { SidecarClient } from "../lib/ws-client";
import { AccionesPicker, Btn, Card, DesignCard, Field, NumberField, UrlCard, grid2, grid3, inputStyle } from "./overlays-ui";

/** Módulo "Temporizador": enlace del overlay, control y configuración (como TikFinity). */
export function TemporizadorView({ client }: { client: SidecarClient | null }) {
  const ov = useOverlays(client);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>Temporizador</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Una cuenta atrás que tus espectadores pueden alargar o acortar con regalos, seguidores, likes y más.
        </p>
      </div>
      {!ov.config || !ov.state ? (
        <div style={{ ...{ padding: 18, background: "#17181D", border: "1px solid #2A2C33", borderRadius: 14 }, color: "#9A9CA5", fontSize: 13 }}>
          Conectando con el sidecar…
        </div>
      ) : (
        <>
          {ov.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{ov.error}</div>}
          <TimerPage client={client} state={ov.state} config={ov.config} ov={ov} />
        </>
      )}
    </div>
  );
}

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
  const [customizing, setCustomizing] = useState(false);
  const remaining = useRemaining(state);
  const [step, setStep] = useState(10);
  const tc = config.timer;
  const status = state.timer.status;
  const [title, setTitle] = useState(tc.title);
  useEffect(() => setTitle(tc.title), [tc.title]);
  const rate = timerRateText(tc);

  function patchTimer(patch: Partial<TimerConfig>) {
    ov.saveConfig({ ...config, timer: { ...tc, ...patch } });
  }

  return (
    <>
      <UrlCard
        kind="timer"
        title="Overlay"
        stable
        onCustomize={() => setCustomizing((v) => !v)}
        customizeLabel={customizing ? "Cerrar personalización" : "Personalizar diseño"}
      />

      {customizing && (
        <DesignCard
          kind="timer"
          showPreview={false}
          style={config.timerStyle}
          onChange={(s) => ov.saveConfig({ ...config, timerStyle: s })}
        />
      )}

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
              {formatTimerMs(remaining)}
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

      <Card title="Configuración">
        <Field label="Título" hint="se muestra sobre el temporizador, p. ej. EXTENSIBLE. Vacío = sin título">
          <input
            value={title}
            maxLength={60}
            placeholder="EXTENSIBLE"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== tc.title && patchTimer({ title })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={inputStyle}
          />
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={tc.showRate}
            onChange={(e) => patchTimer({ showRate: e.target.checked })}
          />
          Mostrar cuánto suma cada moneda bajo el título
          <span style={{ color: "#9A9CA5" }}>
            {rate ? `(ahora: ${rate})` : "(aparece cuando “Por moneda” suma o resta segundos)"}
          </span>
        </label>

        <div style={grid2}>
          <Field
            label="Tiempo inicial (s)"
            hint={
              tc.startSeconds === 0
                ? "0 = sin tiempo inicial: arranca con la primera interacción"
                : `= ${formatTimerMs(tc.startSeconds * 1000)} · se aplica al Comenzar o Reiniciar; no cambia un timer que ya corre`
            }
          >
            <NumberField value={tc.startSeconds} min={0} onCommit={(v) => patchTimer({ startSeconds: v })} />
          </Field>
          <Field label="Tiempo máximo (s)" hint="0 = sin máximo">
            <NumberField value={tc.maxSeconds} min={0} onCommit={(v) => patchTimer({ maxSeconds: v })} />
          </Field>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={tc.autoStart}
            onChange={(e) => patchTimer({ autoStart: e.target.checked })}
          />
          Iniciar solo: si está en 0 o detenido, la primera interacción que suma tiempo lo inicia
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={tc.rememberOnClose}
            onChange={(e) => patchTimer({ rememberOnClose: e.target.checked })}
          />
          Recordar el tiempo al cerrar la app (vuelve en pausa)
        </label>

        <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Segundos por interacción</div>
        <div style={{ fontSize: 12, color: "#9A9CA5", lineHeight: 1.5 }}>
          Cuántos segundos suma o resta el timer por cada interacción. Usa valores <b>positivos</b> para aumentar y{" "}
          <b>negativos</b> (p. ej. −5) para disminuir; también decimales, p. ej. 0.05 si un segundo completo es
          demasiado. Para algo más concreto (un regalo específico, un comando del chat) crea un Evento con el comando
          “Timer: sumar/restar segundos”.
        </div>
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
          Los espectadores suman mientras el timer corre o, con “Iniciar solo”, también desde 0. En pausa no suma.
        </div>

        <AccionesPicker label="Al expirar, ejecutar" client={client} ids={tc.onExpireAccionIds} onChange={(ids) => patchTimer({ onExpireAccionIds: ids })} />
      </Card>
    </>
  );
}
