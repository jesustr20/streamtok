import { useState } from "react";
import type { Accion, AccionMedia, ModAction, ModHelloPayload } from "@streamtok/shared";
import { getCategoryIcon } from "../lib/categoryIcons";
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

const ACCENT = "#E23A57";

const GENERALES = [
  "Comandos Minecraft",
  "Play Audio",
  "Mostrar IMG / GIF / VIDEO",
  "Mostrar Alerta",
  "Animaciones",
  "Simular Keystrokes",
  "Read Text (TTS)",
  "Streamer.bot Action",
  "Comandos WebHook",
  "Conexión RCON",
  "Conexión OBS",
];

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
 * Modal "Nueva Acción" / "Editar Acción" (ModNuevaAccion.dc.html). La lista de
 * comandos reutiliza `ParamEditor` real; el resto ("¿Qué deseas realizar?",
 * el bloque de ejemplo y "Configuraciones adicionales") es estructura visual
 * sin backend de acciones generales todavía.
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
      descripcion: initial?.descripcion ?? "",
      duracionSeg: initial?.duracionSeg ?? 0,
      puntos: initial?.puntos ?? 0,
      pantalla: initial?.pantalla ?? null,
      media: initial?.media ?? emptyMedia(),
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

        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de la acción"
          autoFocus
          style={{
            height: 42,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 9,
            color: "#F4F4F5",
            padding: "0 14px",
            fontSize: 13,
            outline: "none",
            fontFamily: "'Manrope', sans-serif",
            boxSizing: "border-box",
          }}
        />

        {/* ¿Qué deseas realizar? */}
        <div style={{ border: "1px solid #2A2C33", borderRadius: 10, overflow: "hidden" }}>
          <div
            style={{
              padding: "12px 14px",
              background: "#0E0F12",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            » ¿Qué deseas realizar?
          </div>
          {GENERALES.map((g) => (
            <div
              key={g}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                borderTop: "1px solid #1E2027",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: "1px solid #2A2C33",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 12.5 }}>{g}</span>
            </div>
          ))}
        </div>

        {/* Commands */}
        <div
          style={{
            padding: 14,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#C4C5CC" }}>
              Commands {comandos.length}/10 · GTA V Chaos Mod
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#9A9CA5" }}>Delay #1:</span>
              <div
                style={{
                  width: 50,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#17181D",
                  border: "1px solid #2A2C33",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                0ms
              </div>
            </div>
          </div>

          {actions.length === 0 && (
            <div style={{ fontSize: 12, color: "#5B5D66" }}>
              Sin catálogo del mod: no hay comandos para elegir. Conecta el mod a ws://localhost:7331.
            </div>
          )}

          {comandos.map((c, i) => {
            const action = actions.find((a) => a.id === c.modActionId);
            return (
              <div
                key={c.key}
                style={{
                  padding: 12,
                  background: "#17181D",
                  border: "1px solid #2A2C33",
                  borderRadius: 9,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700 }}>Command #{i + 1}</span>
                  <button type="button" onClick={() => removeComando(c.key)} style={closeCommandStyle}>
                    ✕
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 10.5, color: "#9A9CA5" }}>Comando del mod</label>
                  <CommandPicker
                    value={c.modActionId}
                    actions={actions}
                    onSelect={(id) => selectAction(c.key, id)}
                  />
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

          <button
            type="button"
            onClick={addComando}
            disabled={actions.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: actions.length === 0 ? "#5B5D66" : "#34D399",
              background: "none",
              border: "none",
              cursor: actions.length === 0 ? "default" : "pointer",
              padding: 0,
              alignSelf: "flex-start",
            }}
          >
            <span style={{ fontSize: 13 }}>+</span>
            <span style={{ fontSize: 11.5, fontWeight: 700 }}>Add command</span>
          </button>
        </div>

        {/* Comando general de ejemplo */}
        <div
          style={{
            padding: 14,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 10, color: "#FFFFFF" }}>✓</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Comando General: Simular Keystrokes</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <div style={chipStyle}>
              Tecla: <b>1</b>
            </div>
            <div style={chipStyle}>Tipo: Tap</div>
            <div style={chipStyle}>250 ms</div>
          </div>
          <span style={{ fontSize: 11, color: "#5B7CFA", fontWeight: 600 }}>↗ Expandir Editor</span>
        </div>

        {/* Configuraciones adicionales */}
        <div
          style={{
            padding: 14,
            background: "#0E0F12",
            border: "1px solid #2A2C33",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "#C4C5CC" }}>
            Configuraciones adicionales
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10.5, color: "#9A9CA5" }}>Cola de alertas</label>
              <select style={additionalSelectStyle}>
                <option>Screen 1</option>
                <option>Screen 2</option>
              </select>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10.5, color: "#9A9CA5" }}>Cola de animaciones</label>
              <select style={additionalSelectStyle}>
                <option>Screen 1</option>
                <option>Screen 2</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, maxWidth: 160 }}>
            <label style={{ fontSize: 10.5, color: "#9A9CA5" }}>Retraso de la acción</label>
            <div
              style={{
                height: 32,
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                background: "#17181D",
                border: "1px solid #2A2C33",
                borderRadius: 7,
                fontSize: 12,
              }}
            >
              0 seg
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: ACCENT,
                flexShrink: 0,
                marginTop: 1,
              }}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>¿Repetir con combo de regalos?</div>
              <div style={{ fontSize: 10.5, color: "#5B5D66" }}>
                Se ejecuta por cada regalo enviado, no solo una vez.
              </div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 10.5, color: "#5B5D66", lineHeight: 1.5 }}>
            Recuerda: para que esta acción sea visible en tu stream, la pantalla elegida arriba debe
            estar pegada como fuente "Link" en TikTok LIVE Studio u OBS.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 10px",
              background: "#2A1416",
              border: "1px solid #E23A57",
              borderRadius: 8,
              color: "#F4A5B4",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={footerStyle}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>
            Descartar
          </button>
          <button type="button" onClick={submit} style={primaryButtonStyle}>
            ✓ Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandPicker({
  value,
  actions,
  onSelect,
}: {
  value: string;
  actions: ModAction[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const selected = actions.find((a) => a.id === value);
  const SelectedIcon = selected ? getCategoryIcon(selected.category) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...pickerTriggerStyle, color: selected ? "#F4F4F5" : "#5B5D66" }}
      >
        {selected && SelectedIcon ? (
          <>
            <SelectedIcon size={16} />
            <span style={pickerTriggerLabelStyle}>{selected.name}</span>
          </>
        ) : (
          <span style={pickerTriggerLabelStyle}>Seleccionar comando…</span>
        )}
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 15 }}
            onClick={() => setOpen(false)}
          />
          <div style={pickerDropdownStyle}>
            {actions.map((a) => {
              const Icon = getCategoryIcon(a.category);
              const active = a.id === value || hovered === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onMouseEnter={() => setHovered(a.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    onSelect(a.id);
                    setOpen(false);
                  }}
                  style={{
                    ...pickerOptionStyle,
                    background: active ? "#1E2027" : "transparent",
                    color: active ? "#F4F4F5" : "#9A9CA5",
                  }}
                >
                  <Icon size={16} />
                  <span style={pickerOptionLabelStyle}>{a.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

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

const closeCommandStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B5D66",
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
};

const pickerTriggerStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  cursor: "pointer",
  boxSizing: "border-box",
};

const pickerTriggerLabelStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "left",
  fontSize: 12,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pickerDropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 16,
  display: "flex",
  flexDirection: "column",
  maxHeight: 220,
  overflowY: "auto",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  boxShadow: "0 12px 32px #00000080",
  padding: 4,
  boxSizing: "border-box",
};

const pickerOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 8px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

const pickerOptionLabelStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const additionalSelectStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  color: "#F4F4F5",
  fontSize: 12,
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
  boxSizing: "border-box",
};

const chipStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 6,
  fontSize: 11,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
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
