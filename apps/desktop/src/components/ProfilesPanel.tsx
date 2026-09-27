import { useEffect, useState } from "react";
import type { ProfileSummary, ProfilesMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";

/**
 * Selector de perfil activo + gestión de perfiles (ADR 0002). El sidecar hace
 * broadcast del estado por el canal `profiles`; acá se espeja y se mandan las
 * operaciones (create/duplicate/rename/delete/set-active).
 */
export function ProfilesPanel({ client }: { client: SidecarClient | null }) {
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 14,
        background: "#14151A",
        border: "1px solid #2A2C33",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>Perfiles</div>

      <label style={labelStyle}>
        Perfil activo
        <select
          style={inputStyle}
          value={activeProfileId ?? ""}
          onChange={(e) => e.target.value && client?.send("profiles", { kind: "set-active", id: e.target.value })}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.eventoCount} {p.eventoCount === 1 ? "evento" : "eventos"})
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div style={{ padding: "8px 10px", background: "#2A141A", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {profiles.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              background: "#17181D",
              border: `1px solid ${p.id === activeProfileId ? "#34D399" : "#2A2C33"}`,
              borderRadius: 8,
            }}
          >
            {renamingId === p.id ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={renamingName}
                  autoFocus
                  onChange={(e) => setRenamingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(p.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                />
                <button onClick={() => commitRename(p.id)} style={linkButtonStyle}>
                  Guardar
                </button>
                <button onClick={() => setRenamingId(null)} style={{ ...linkButtonStyle, color: "#9A9CA5" }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span style={{ fontSize: 13 }}>
                  {p.name}
                  {p.id === activeProfileId && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: "#34D399" }}>activo</span>
                  )}
                  <span style={{ marginLeft: 6, fontSize: 10.5, color: "#5B5D66" }}>
                    {p.eventoCount} {p.eventoCount === 1 ? "evento" : "eventos"}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  {p.id !== activeProfileId && (
                    <button
                      onClick={() => client?.send("profiles", { kind: "set-active", id: p.id })}
                      style={linkButtonStyle}
                    >
                      Activar
                    </button>
                  )}
                  <button onClick={() => startRename(p)} style={linkButtonStyle}>
                    Renombrar
                  </button>
                  <button onClick={() => client?.send("profiles", { kind: "duplicate", id: p.id })} style={linkButtonStyle}>
                    Duplicar
                  </button>
                  <button
                    onClick={() => client?.send("profiles", { kind: "delete", id: p.id })}
                    disabled={profiles.length <= 1}
                    style={{
                      ...linkButtonStyle,
                      color: "#E23A57",
                      ...(profiles.length <= 1 ? { opacity: 0.4, cursor: "default" } : {}),
                    }}
                  >
                    Eliminar
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={newName}
          placeholder="Nombre del nuevo perfil"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <button
          onClick={create}
          disabled={!newName.trim()}
          style={!newName.trim() ? disabledButtonStyle : primaryButtonStyle}
        >
          Crear
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#9A9CA5",
};

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B7CFA",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#E23A57",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2A2C33",
  border: "none",
  borderRadius: 8,
  color: "#5B5D66",
  fontSize: 13,
  fontWeight: 700,
  cursor: "default",
};
