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

/**
 * Sección "Conexión y Acceso" (ModDetalle.dc.html): indicador de instalación
 * (detecta la carpeta de GTA V), botones Instalar/Actualizar/Borrar y aviso de
 * error si la carpeta no es válida.
 */
export function ConexionAcceso() {
  const [gamePath, setGamePath] = useState<string | null>(null);
  const [detected, setDetected] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [invalidFolder, setInvalidFolder] = useState<string | null>(null);
  const [missingDeps, setMissingDeps] = useState<MissingDependency[]>([]);

  useEffect(() => {
    invoke<string | null>("find_gta_v_path")
      .then((p) => {
        setGamePath(p);
        setDetected(p !== null);
      })
      .catch(() => setDetected(false));
  }, []);

  async function runInstall() {
    setRunning(true);
    setInvalidFolder(null);
    setMissingDeps([]);
    try {
      const result = await invoke<InstallReport>("install_gta_v_mod", { gamePath: null });
      if (result.game_path) {
        setGamePath(result.game_path);
        setDetected(true);
      }
      setMissingDeps(result.missing_dependencies);
    } catch (e) {
      setInvalidFolder(String(e));
    } finally {
      setRunning(false);
    }
  }

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
          {detected ? (
            <>
              Instalado en: <b style={{ color: "#F4F4F5" }}>{gamePath}</b>
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
          disabled={running}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: ACCENT,
            color: "#FFFFFF",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? "Instalando…" : "⇩ Instalar Mod"}
        </button>
        <button
          type="button"
          onClick={runInstall}
          disabled={running}
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1E2027",
            color: "#5B5D66",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: running ? "default" : "pointer",
          }}
        >
          Actualizar mod
        </button>
        <button
          type="button"
          style={{
            padding: "0 18px",
            height: 42,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid #3A2020",
            color: "#E5484D",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Borrar mod
        </button>
      </div>

      {invalidFolder && (
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
              Esta carpeta no parece ser GTA V
            </span>
            <span style={{ fontSize: 12, color: "#C97A7E" }}>
              {invalidFolder} Verifica que elegiste la carpeta correcta e intenta instalar de nuevo.
            </span>
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
