import { useEffect, useState } from "react";
import { useAgenteMemoria } from "../lib/use-agente-memoria";
import type { SidecarClient } from "../lib/ws-client";
import { Btn, Card, Field, inputStyle } from "./overlays-ui";

/**
 * «Memoria del agente» (ADR 0024, fase 1): lo que el agente sabe del streamer (nombre, apodos y datos que tú escribes)
 * y cuántos viewers recuerda. Todo se guarda en agente-memoria.json, en tu equipo.
 */
export function AgenteMemoria({ client }: { client: SidecarClient | null }) {
  const m = useAgenteMemoria(client);
  const [confirmClear, setConfirmClear] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [fact, setFact] = useState("");
  const s = m.streamer;
  useEffect(() => {
    setName(s?.name ?? "");
    setAliases((s?.aliases ?? []).join(", "));
  }, [s?.name, s?.aliases]);

  if (!s) return null;
  const parsedAliases = () => aliases.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 10);
  const dirty = name.trim() !== s.name || parsedAliases().join(", ") !== s.aliases.join(", ");
  const addFact = () => {
    if (!fact.trim()) return;
    m.addFact(fact.trim());
    setFact("");
  };

  return (
    <Card title="Memoria del agente">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Lo que el agente sabe de ti y de tu chat para responder con más precisión. Cuando alguien pregunte por «el streamer» o por tu nombre,
        responde sobre ti, con lo que escribas aquí. No gasta saldo del modelo.
        {s.handle ? <> Tu cuenta conectada: <b>@{s.handle}</b>.</> : <> Conecta tu LIVE para que tome tu cuenta.</>}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ width: 220 }}>
          <Field label="Tu nombre" hint="como quieres que te llame">
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Field label="Otros nombres o apodos (separados por coma)" hint="por los que el chat te llama">
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
          </Field>
        </div>
        <div style={{ paddingTop: 20 }}>
          <Btn primary disabled={!dirty} onClick={() => m.saveStreamer(name.trim(), parsedAliases())}>
            Guardar
          </Btn>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Datos sobre ti ({s.facts.length}/100)</div>
        <div style={{ fontSize: 12, color: "#9A9CA5", lineHeight: 1.5 }}>
          Cosas que quieres que sepa: qué juegas, de dónde eres, de qué va tu canal. Una por línea. Solo se usan los que vienen al caso con cada pregunta.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={fact}
            maxLength={300}
            placeholder="Ej.: Juego GTA V con mods y hago carreras en Roblox"
            onChange={(e) => setFact(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFact()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <Btn onClick={addFact} disabled={!fact.trim()}>
            Agregar
          </Btn>
        </div>
        {s.facts.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{f.text}</span>
            <button
              type="button"
              title="Borrar este dato"
              onClick={() => m.removeFact(f.id)}
              style={{ background: "none", border: "none", color: "#E5484D", cursor: "pointer", fontSize: 14 }}
            >
              🗑
            </button>
          </div>
        ))}
        {m.error && <div style={{ color: "#E5484D", fontSize: 12 }}>{m.error}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingTop: 4 }}>
        <span style={{ fontSize: 12.5, color: "#C9CBD2" }}>
          Viewers que recuerda: <b>{m.viewerCount}</b> (nombre, cuándo los vio y cuántas preguntas hicieron).
        </span>
        {confirmClear ? (
          <>
            <span style={{ fontSize: 12, color: "#E5484D" }}>¿Borrar a todos?</span>
            <Btn
              onClick={() => {
                m.clearViewers();
                setConfirmClear(false);
              }}
            >
              Sí, borrar
            </Btn>
            <Btn onClick={() => setConfirmClear(false)}>Cancelar</Btn>
          </>
        ) : (
          <Btn disabled={m.viewerCount === 0} onClick={() => setConfirmClear(true)}>
            Olvidar a todos
          </Btn>
        )}
      </div>
    </Card>
  );
}
