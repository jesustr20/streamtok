import { useEffect, useState } from "react";
import type { ProfileSummary, ProfilesMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";

const ACCENT = "#E23A57";

/**
 * Pantalla "Gestionar perfiles" (ModPerfiles.dc.html): una fila por perfil con
 * Renombrar/Duplicar/Borrar, más el formulario de crear uno nuevo, y link de
 * vuelta al detalle del mod. Usa el canal WS `profiles` (ADR 0002).
 */
export function GestionarPerfiles({
  client,
  onBack,
}: {
  client: SidecarClient | null;
  onBack: () => void;
}) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "profiles") return;
      const msg = evt.payload as ProfilesMessage;
      if (msg.kind === "state") {
        setProfiles(msg.profiles);
        setActiveProfileId(msg.activeProfileId);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    // Snapshot bajo demanda: si esta pantalla se monta después de la conexión
    // inicial, pide el estado actual (no lo recibió en `client-connected`).
    client.send("profiles", { kind: "get-state" });
    return off;
  }, [client]);

  function create() {
    if (!newName.trim()) return;
    client?.send("profiles", { kind: "create", name: newName.trim() });
    setNewName("");
  }

  function commitRename(id: string) {
    if (!renamingName.trim()) return;
    client?.send("profiles", { kind: "rename", id, name: renamingName.trim() });
    setRenamingId(null);
    setRenamingName("");
  }

  function startRename(p: ProfileSummary) {
    setRenamingId(p.id);
    setRenamingName(p.name);
    setError(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
      <button type="button" onClick={onBack} style={backLinkStyle}>
        ‹ Volver a GTA V Chaos Mod
      </button>

      <div>
        <span style={eyebrowStyle}>PERFILES · GTA V CHAOS MOD</span>
        <h1 style={titleStyle}>Gestionar perfiles</h1>
        <p style={descStyle}>
          Cada perfil guarda su propia configuración de Regalos/Eventos y Reglas de Comunidad.
          Solo uno está activo a la vez.
        </p>
      </div>

      <div style={listContainerStyle}>
        {profiles.map((p, i) => {
          const renaming = renamingId === p.id;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                borderTop: i === 0 ? "none" : "1px solid #22242B",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: p.id === activeProfileId ? "#34D399" : "#3A3C44",
                  flexShrink: 0,
                }}
              />
              <div style={{ flexGrow: 1, minWidth: 0 }}>
                {renaming ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      autoFocus
                      value={renamingName}
                      onChange={(e) => setRenamingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      style={renameInputStyle}
                    />
                    <button type="button" onClick={() => commitRename(p.id)} style={linkButtonStyle}>
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      style={{ ...linkButtonStyle, color: "#9A9CA5" }}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "#9A9CA5", marginTop: 2 }}>
                      {p.id === activeProfileId ? "Activo · " : ""}
                      {p.eventoCount}{" "}
                      {p.eventoCount === 1 ? "evento configurado" : "eventos configurados"}
                    </div>
                  </>
                )}
              </div>

              {!renaming && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => startRename(p)} style={rowButtonStyle}>
                    ✎ Renombrar
                  </button>
                  <button
                    type="button"
                    onClick={() => client?.send("profiles", { kind: "duplicate", id: p.id })}
                    style={rowButtonStyle}
                  >
                    ⧉ Duplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => client?.send("profiles", { kind: "delete", id: p.id })}
                    disabled={profiles.length <= 1}
                    style={{
                      ...rowButtonStyle,
                      color: "#E5484D",
                      ...(profiles.length <= 1 ? { opacity: 0.4, cursor: "default" } : {}),
                    }}
                  >
                    🗑 Borrar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ display: "flex", gap: 10, maxWidth: 640 }}>
        <input
          style={{ ...createInputStyle, flexGrow: 1 }}
          value={newName}
          placeholder="Nombre del nuevo perfil (ej. GTA Eventos Sábados)"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <button
          type="button"
          onClick={create}
          disabled={!newName.trim()}
          style={!newName.trim() ? disabledButtonStyle : createButtonStyle}
        >
          + Crear perfil
        </button>
      </div>

      <p style={noteStyle}>
        Un perfil nuevo empieza completamente vacío — sin regalos, eventos ni reglas configuradas.
        "Duplicar" crea una copia editable de uno existente, útil para partir de una config ya
        armada.
      </p>
    </div>
  );
}

const backLinkStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "#9A9CA5",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  alignSelf: "flex-start",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#5B7CFA",
  letterSpacing: "0.06em",
};

const titleStyle: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 22,
  fontWeight: 700,
  fontFamily: "'Space Grotesk', sans-serif",
};

const descStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "#9A9CA5",
  maxWidth: 520,
  lineHeight: 1.5,
};

const listContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  border: "1px solid #2A2C33",
  borderRadius: 14,
  overflow: "hidden",
  maxWidth: 640,
};

const rowButtonStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 7,
  background: "#1E2027",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#C4C5CC",
  border: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B7CFA",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  height: 36,
  padding: "0 12px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
};

const errorStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#2A141A",
  border: "1px solid #E23A57",
  borderRadius: 8,
  color: "#F4A5B4",
  fontSize: 12,
  maxWidth: 640,
};

const createInputStyle: React.CSSProperties = {
  height: 44,
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 10,
  color: "#F4F4F5",
  padding: "0 14px",
  fontSize: 13,
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
};

const createButtonStyle: React.CSSProperties = {
  padding: "0 20px",
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: ACCENT,
  color: "#FFFFFF",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: "nowrap",
  border: "none",
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  padding: "0 20px",
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#2A2C33",
  color: "#5B5D66",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: "nowrap",
  border: "none",
  cursor: "default",
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  color: "#5B5D66",
  maxWidth: 640,
  lineHeight: 1.5,
};
