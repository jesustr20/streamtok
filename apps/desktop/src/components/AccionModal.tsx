import { useState } from "react";
import type { Accion, AccionMedia, ModHelloPayload } from "@streamtok/shared";
import {
  defaultParamValues,
  ParamEditor,
  sanitizeParamValues,
  type ParamValues,
} from "./ParamEditor";

type ComandoDraft = {
  key: string;
  modActionId: string;
  params: ParamValues;
};

function newId(): string {
  return crypto.randomUUID();
}

function toParamValues(params: Record<string, unknown>): ParamValues {
  const out: ParamValues = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function emptyMedia(): AccionMedia {
  return { animacion: false, imagen: false, sonido: false, video: false };
}

/**
 * Modal "Nueva Acción" / "Editar Acción" (issue #24). La lista de `comandos`
 * reutiliza `ParamEditor` para elegir el comando del catálogo del mod y editar
 * sus params; cada Acción puede tener más de un comando.
 */
export function AccionModal({
  catalog,
  initial,
  onSave,
  onClose,
}: {
  catalog: ModHelloPayload | null;
  initial: Accion | null;
  onSave: (accion: Accion) => void;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  const [pantalla, setPantalla] = useState(initial?.pantalla ?? "");
  const [duracionSeg, setDuracionSeg] = useState<number>(initial?.duracionSeg ?? 0);
  const [puntos, setPuntos] = useState<number>(initial?.puntos ?? 0);
  const [media, setMedia] = useState<AccionMedia>(initial?.media ?? emptyMedia());
  const [comandos, setComandos] = useState<ComandoDraft[]>(
    initial?.comandos.map((c) => ({
      key: newId(),
      modActionId: c.modActionId,
      params: toParamValues(c.params),
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const actions = catalog?.actions ?? [];

  function addComando() {
    setComandos((prev) => [...prev, { key: newId(), modActionId: "", params: {} }]);
  }

  function patchComando(key: string, patch: Partial<ComandoDraft>) {
    setComandos((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function removeComando(key: string) {
    setComandos((prev) => prev.filter((c) => c.key !== key));
  }

  function selectAction(key: string, modActionId: string) {
    const action = actions.find((a) => a.id === modActionId);
    patchComando(key, {
      modActionId,
      params: action ? defaultParamValues(action.params) : {},
    });
  }

  function setMediaFlag(flag: keyof AccionMedia, value: boolean) {
    setMedia((prev) => ({ ...prev, [flag]: value }));
  }

  function submit() {
    const name = nombre.trim();
    if (!name) {
      setError("El nombre es obligatorio.");
      return;
    }

    const validComandos = comandos
      .filter((c) => c.modActionId !== "")
      .map((c) => ({ modActionId: c.modActionId, params: sanitizeParamValues(c.params) }));

    onSave({
      id: initial?.id ?? newId(),
      nombre: name,
      descripcion: descripcion.trim(),
      duracionSeg: Number.isFinite(duracionSeg) ? duracionSeg : 0,
      puntos: Number.isFinite(puntos) ? puntos : 0,
      pantalla: pantalla.trim() ? pantalla.trim() : null,
      media: { ...media },
      comandos: validComandos,
    });
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <span style={eyebrowStyle}>MODAL · ABIERTO DESDE GTA V CHAOS MOD</span>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>{initial ? "Editar Acción" : "Nueva Acción"}</h2>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          <label style={labelStyle}>
            Nombre
            <input style={inputStyle} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </label>

          <label style={labelStyle}>
            Descripción
            <textarea
              style={{ ...inputStyle, height: "auto", minHeight: 60, padding: "10px 14px", resize: "vertical" }}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </label>

          <label style={labelStyle}>
            Pantalla
            <input
              style={inputStyle}
              value={pantalla}
              placeholder="Sin servidor de overlay aún — texto libre"
              onChange={(e) => setPantalla(e.target.value)}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelStyle}>
              Duración (seg.)
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(duracionSeg) ? duracionSeg : ""}
                min={0}
                onChange={(e) => setDuracionSeg(e.target.value === "" ? NaN : Number(e.target.value))}
              />
            </label>
            <label style={labelStyle}>
              Puntos +/-
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(puntos) ? puntos : ""}
                onChange={(e) => setPuntos(e.target.value === "" ? NaN : Number(e.target.value))}
              />
            </label>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10.5, color: "#9A9CA5" }}>Media (flags informativos, sin subida real)</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {(["animacion", "imagen", "sonido", "video"] as const).map((flag) => (
                <label key={flag} style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={media[flag]}
                    onChange={(e) => setMediaFlag(flag, e.target.checked)}
                  />
                  {flag === "animacion" ? "Animación" : flag === "imagen" ? "Imagen" : flag === "sonido" ? "Sonido" : "Video"}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10.5, color: "#9A9CA5" }}>Comandos del mod</span>
              <button
                type="button"
                onClick={addComando}
                disabled={actions.length === 0}
                style={actions.length === 0 ? disabledButtonStyle : secondaryButtonStyle}
              >
                + Agregar comando
              </button>
            </div>

            {actions.length === 0 && (
              <div style={{ fontSize: 12, color: "#5B5D66" }}>
                Sin catálogo del mod: no hay comandos para elegir. Conecta el mod a ws://localhost:7331.
              </div>
            )}

            {comandos.map((c) => {
              const action = actions.find((a) => a.id === c.modActionId);
              return (
                <div key={c.key} style={commandBlockStyle}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={c.modActionId}
                      onChange={(e) => selectAction(c.key, e.target.value)}
                    >
                      <option value="">Seleccionar comando…</option>
                      {actions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => removeComando(c.key)} style={linkButtonStyle}>
                      Quitar
                    </button>
                  </div>

                  {action && action.params.length > 0 && (
                    <ParamEditor
                      key={`${c.key}-${action.id}`}
                      params={action.params}
                      initialValues={c.params}
                      onChange={(v) => patchComando(c.key, { params: v })}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div style={{ padding: "8px 10px", background: "#2A1416", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>
            Cancelar
          </button>
          <button type="button" onClick={submit} style={primaryButtonStyle}>
            {initial ? "Guardar cambios" : "Crear Acción"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ACCENT = "#E23A57";

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(14, 15, 18, 0.61)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  zIndex: 100,
  padding: 40,
  overflowY: "auto",
};

const cardStyle: React.CSSProperties = {
  width: 560,
  maxWidth: "100%",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 16,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  boxShadow: "0 20px 60px #00000080",
  boxSizing: "border-box",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#5B7CFA",
  letterSpacing: "0.06em",
};

const titleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 17,
  fontWeight: 700,
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B5D66",
  fontSize: 16,
  cursor: "pointer",
  padding: 0,
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 14px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  color: "#F4F4F5",
  fontSize: 12,
  boxSizing: "border-box",
};

const commandBlockStyle: React.CSSProperties = {
  padding: 14,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 10.5,
  color: "#9A9CA5",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "0 18px",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: ACCENT,
  border: "none",
  borderRadius: 9,
  color: "#FFFFFF",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#1E2027",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  color: "#C4C5CC",
  fontSize: 12,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  background: "#23252C",
  color: "#5B5D66",
  cursor: "default",
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "0 18px",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#C4C5CC",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: ACCENT,
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
