import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const ACCENT = "#E23A57";

interface MissingDependency {
  name: string;
  official_url: string;
  reason: string;
}

interface InstallReport {
  game_path: string | null;
  script_hook_v_found: boolean;
  script_hook_v_dotnet_found: boolean;
  dll_copied: boolean;
  dll_version: string | null;
  unblocked: boolean;
  ini_written: boolean;
  missing_dependencies: MissingDependency[];
  warnings: string[];
}

interface ModStatus {
  game_path: string | null;
  installed: boolean;
  installed_version: string | null;
  latest_version: string | null;
  update_available: boolean;
}

/**
 * Sección "Conexión y Acceso" (ModDetalle.dc.html): indicador de instalación
 * (detecta la carpeta de GTA V), botones Instalar/Actualizar/Borrar y aviso de
 * error si falla la instalación o el borrado.
 *
 * Los tres botones reflejan el estado real del mod (consultado con
 * `get_mod_status`, que compara la versión instalada contra la última
 * Release), en vez de estar siempre activos/inactivos sin importar si el mod
 * ya está puesto o no:
 *  - "Instalar Mod": solo si NO está instalado.
 *  - "Actualizar mod": solo si está instalado Y hay una versión más nueva.
 *  - "Borrar mod": solo si está instalado; pide una segunda confirmación en
 *    el propio botón antes de borrar (sin agregar una librería de diálogos
 *    nueva para algo tan simple).
 */
export function ConexionAcceso() {
  const [status, setStatus] = useState<ModStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [running, setRunning] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null);
  const [missingDeps, setMissingDeps] = useState<MissingDependency[]>([]);

  function refreshStatus(gamePath?: string | null) {
    setLoadingStatus(true);
    invoke<ModStatus>("get_mod_status", { gamePath: gamePath ?? null })
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoadingStatus(false));
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function runInstall() {
    setRunning(true);
    setActionError(null);
    setMissingDeps([]);
    try {
      const result = await invoke<InstallReport>("install_gta_v_mod", { gamePath: null });
      setMissingDeps(result.missing_dependencies);
      refreshStatus(result.game_path);
    } catch (e) {
      setActionError({ title: "No se pudo instalar el mod", message: String(e) });
    } finally {
      setRunning(false);
    }
  }

  async function runUninstall() {
    if (!status?.game_path) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setUninstalling(true);
    try {
      await invoke("uninstall_gta_v_mod", { gamePath: status.game_path });
      refreshStatus(status.game_path);
    } catch (e) {
      setActionError({ title: "No se pudo borrar el mod", message: String(e) });
    } finally {
      setUninstalling(false);
      setConfirmDelete(false);
    }
  }

  const detected = status?.installed ?? false;
  const gamePath = status?.game_path ?? null;
  const canInstall = !detected && !running;
  const canUpdate = detected && (status?.update_available ?? false) && !running;
  const canDelete = detected && !uninstalling;

  return (
    <div
      style={{
        padding: 22,
        background: "#17181D",
        border: "1px solid #2A2C33",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#F5A623", letterSpacing: "0.06em" }}>
          SISTEMA DE JUEGO
        </span>
        <h2 style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          Conexión y Acceso
        </h2>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          background: "#0E0F12",
          border: "1px solid #2A2C33",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: detected ? "#34D399" : "#3A3C44",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12.5, color: "#C4C5CC" }}>
          {loadingStatus ? (
            "Comprobando instalación…"
          ) : detected ? (
            <>
              Instalado{status?.installed_version ? ` (v${status.installed_version})` : ""} en:{" "}
              <b style={{ color: "#F4F4F5" }}>{gamePath}</b>
              {status?.update_available && status?.latest_version && (
                <span style={{ color: "#F5A623" }}> — hay una nueva versión v{status.latest_version}</span>
              )}
            </>
          ) : (
            "No se detectó la carpeta de GTA V todavía."
          )}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={runInstall}
          disabled={!canInstall}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: canInstall ? ACCENT : "#1E2027",
            color: canInstall ? "#FFFFFF" : "#5B5D66",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: canInstall ? "pointer" : "default",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? "Instalando…" : detected ? "✓ Mod instalado" : "⇩ Instalar Mod"}
        </button>
        <button
          type="button"
          onClick={runInstall}
          disabled={!canUpdate}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: canUpdate ? ACCENT : "#1E2027",
            color: canUpdate ? "#FFFFFF" : "#5B5D66",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: canUpdate ? "pointer" : "default",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? "Actualizando…" : canUpdate ? "⇪ Actualizar mod" : "Actualizado"}
        </button>
        <button
          type="button"
          onClick={runUninstall}
          onBlur={() => setConfirmDelete(false)}
          disabled={!canDelete}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: confirmDelete ? "#E5484D" : "transparent",
            border: "1px solid #3A2020",
            color: confirmDelete ? "#FFFFFF" : canDelete ? "#E5484D" : "#5B5D66",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: canDelete ? "pointer" : "default",
            opacity: canDelete ? 1 : 0.6,
          }}
        >
          {uninstalling ? "Borrando…" : confirmDelete ? "¿Seguro? Click de nuevo" : "Borrar mod"}
        </button>
      </div>

      {actionError && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 16px",
            background: "#2A1216",
            border: "1px solid #4A1E22",
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1.3 }}>⚠</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#F5A9AD" }}>
              {actionError.title}
            </span>
            <span style={{ fontSize: 12, color: "#C97A7E" }}>{actionError.message}</span>
          </div>
        </div>
      )}

      {missingDeps.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "12px 16px",
            background: "#1F1408",
            border: "1px solid #4A3418",
            borderRadius: 10,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#F5C570" }}>
            Faltan dependencias que no podemos instalar por ti:
          </span>
          {missingDeps.map((dep) => (
            <span key={dep.name} style={{ fontSize: 12, color: "#F5C570" }}>
              <b>{dep.name}</b> — {dep.reason}{" "}
              <a href={dep.official_url} target="_blank" rel="noreferrer" style={{ color: "#5B7CFA" }}>
                Descargar
              </a>
            </span>
          ))}
        </div>
      )}

      <span style={{ fontSize: 12, color: "#5B5D66" }}>
        Compatible con GTA V Legacy (Steam, Epic, Rockstar). GTA V Enhanced no es compatible.
      </span>
    </div>
  );
}
