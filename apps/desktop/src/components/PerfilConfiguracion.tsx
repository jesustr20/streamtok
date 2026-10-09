import { useEffect, useState } from "react";
import type { ProfileSummary, ProfilesMessage } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { SearchSelect } from "./SearchSelect";

const ACCENT = "#E23A57";

/**
 * Barra "Perfil de configuración" (ModDetalle.dc.html, fondo #141922 /
 * borde #22303F): selector del perfil activo + botón "+ Nuevo perfil" +
 * acceso a "Gestionar perfiles". Gestiona el perfil activo por el canal WS
 * `profiles` (ADR 0002).
 */
export function PerfilConfiguracion({
  client,
  onGestionarPerfiles,
}: {
  client: SidecarClient | null;
  onGestionarPerfiles: () => void;
}) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "profiles") return;
      const msg = evt.payload as ProfilesMessage;
      if (msg.kind === "state") {
        setProfiles(msg.profiles);
        setActiveProfileId(msg.activeProfileId);
      }
    });
    // Snapshot bajo demanda: si esta barra se monta después de la conexión
    // inicial, pide el estado actual (no lo recibió en `client-connected`).
    client.send("profiles", { kind: "get-state" });
    return off;
  }, [client]);

  const activeName = profiles.find((p) => p.id === activeProfileId)?.name ?? "Sin perfiles";

  function create() {
    if (!newName.trim()) return;
    client?.send("profiles", { kind: "create", name: newName.trim() });
    setNewName("");
    setCreating(false);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        background: "#141922",
        border: "1px solid #22303F",
        borderRadius: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 16 }}>🗂</span>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#7C93AD" }}>Perfil de configuración de este mod</span>
            <button
              type="button"
              onClick={onGestionarPerfiles}
              style={{
                fontSize: 11.5,
                color: "#5B7CFA",
                fontWeight: 700,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Gestionar
            </button>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>Aplica a Acciones y Eventos de abajo</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 220 }}>
            <SearchSelect
              value={activeProfileId ?? ""}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Sin perfiles"
              height={38}
              fontSize={13}
              onChange={(id) => id && client?.send("profiles", { kind: "set-active", id })}
            />
          </div>
        </div>

        {creating ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              autoFocus
              value={newName}
              placeholder="Nombre del nuevo perfil"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") setCreating(false);
              }}
              style={{
                height: 38,
                padding: "0 12px",
                background: "#0E0F12",
                border: "1px solid #2A2C33",
                borderRadius: 9,
                color: "#F4F4F5",
                fontSize: 13,
                width: 200,
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={create}
              disabled={!newName.trim()}
              style={{
                height: 38,
                padding: "0 12px",
                background: ACCENT,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 700,
                cursor: newName.trim() ? "pointer" : "default",
                opacity: newName.trim() ? 1 : 0.5,
              }}
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => {
                setNewName("");
                setCreating(false);
              }}
              style={{
                height: 38,
                padding: "0 12px",
                background: "transparent",
                border: "1px solid #2A2C33",
                borderRadius: 9,
                color: "#C4C5CC",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              fontSize: 11.5,
              color: "#5B7CFA",
              fontWeight: 700,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            + Nuevo perfil
          </button>
        )}
      </div>
    </div>
  );
}
