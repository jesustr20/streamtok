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
        <div style={headerStyle}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {initial ? "Editar Acción" : "Nueva Acción"}
          </span>
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
              style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
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
            <span style={{ fontSize: 11, color: "#9A9CA5" }}>Media (flags informativos, sin subida real)</span>
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
              <span style={{ fontSize: 11, color: "#9A9CA5" }}>Comandos del mod</span>
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
                <div key={c.key} style={{ padding: 12, background: "#17181D", border: "1px solid #2A2C33", borderRadius: 9, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      style={{ ...inputStyle, flex: 1 }}
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

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#14151A",
  border: "1px solid #2A2C33",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "1px solid #2A2C33",
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#9A9CA5",
  fontSize: 14,
  cursor: "pointer",
  padding: 4,
};

const bodyStyle: React.CSSProperties = {
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "14px 18px",
  borderTop: "1px solid #2A2C33",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#9A9CA5",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#E23A57",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#1F222B",
  border: "1px solid #2A2C33",
  borderRadius: 8,
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
  padding: "8px 16px",
  background: "transparent",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#C4C5CC",
  fontSize: 13,
  cursor: "pointer",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#E23A57",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
