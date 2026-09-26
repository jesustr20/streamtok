import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

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

/**
 * Botón "Instalar mod de GTA V" — punto 5 del contrato.
 * Flujo: detectar carpeta → si faltan ScriptHookV/SHVDN, mostrar links
 * oficiales sin intentar copiarlos (no se redistribuyen) → si están, bajar
 * la última Release del mod, copiar la DLL a scripts\, desbloquearla y
 * escribir el .ini si no existía.
 */
export function InstallModButton() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [report, setReport] = useState<InstallReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInstall(explicitPath?: string) {
    setStatus("running");
    setError(null);
    try {
      const result = await invoke<InstallReport>("install_gta_v_mod", {
        gamePath: explicitPath ?? null,
      });
      setReport(result);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function handlePickFolder() {
    const folder = await invoke<string | null>("pick_gta_v_folder");
    if (folder) await handleInstall(folder);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
      <button
        onClick={() => handleInstall()}
        disabled={status === "running"}
        style={{
          height: 44,
          borderRadius: 10,
          background: "#E23A57",
          color: "#fff",
          fontWeight: 700,
          border: "none",
          cursor: "pointer",
        }}
      >
        {status === "running" ? "Instalando…" : "Instalar mod de GTA V"}
      </button>

      {error && (
        <div style={{ color: "#E5484D", fontSize: 13 }}>
          {error}{" "}
          <button onClick={handlePickFolder} style={{ marginLeft: 8 }}>
            Elegir carpeta manualmente
          </button>
        </div>
      )}

      {report && report.game_path === null && (
        <div style={{ fontSize: 13, color: "#F5A623" }}>
          No se encontró GTA V automáticamente.{" "}
          <button onClick={handlePickFolder}>Elegir carpeta (donde está GTA5.exe)</button>
        </div>
      )}

      {report && report.missing_dependencies.length > 0 && (
        <div style={{ padding: 12, background: "#17181D", border: "1px solid #2A2C33", borderRadius: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            Faltan dependencias que no podemos instalar por ti:
          </div>
          {report.missing_dependencies.map((dep) => (
            <div key={dep.name} style={{ fontSize: 12.5, marginBottom: 6 }}>
              <b>{dep.name}</b> — {dep.reason}{" "}
              <a href={dep.official_url} target="_blank" rel="noreferrer" style={{ color: "#5B7CFA" }}>
                Descargar
              </a>
            </div>
          ))}
        </div>
      )}

      {report && report.dll_copied && (
        <div style={{ padding: 12, background: "#0F1F17", border: "1px solid #1F3D2E", borderRadius: 10, fontSize: 12.5 }}>
          ✓ Mod instalado (v{report.dll_version}) en <code>{report.game_path}\scripts\</code>
          {report.unblocked ? "" : " — no se pudo desbloquear el archivo automáticamente, revisa Propiedades."}
          {report.ini_written ? " · .ini creado con defaults" : ""}
        </div>
      )}

      {report && report.warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#9A9CA5" }}>
          {report.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
