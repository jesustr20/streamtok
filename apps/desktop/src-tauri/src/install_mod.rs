//! Orquesta el punto 5 del contrato: botón "Instalar mod de GTA V".
//!
//!  1. detectar carpeta del juego (Steam/Epic/Rockstar)
//!  2. comprobar versión (best-effort: existencia de GTA5.exe)
//!  3. comprobar ScriptHookV y ScriptHookVDotNet Enhanced — NO se
//!     redistribuyen: si faltan, se devuelve el link oficial para que el
//!     usuario los instale él mismo
//!  4. crear scripts\
//!  5. copiar StreamTok.GtaV.dll (bajado del Release de GitHub) y
//!     desbloquearlo
//!  6. escribir scripts\StreamTok.GtaV.ini (opcional, con defaults seguros)

use crate::github_release::fetch_latest_dll;
use crate::gta_locate::find_gta_v_install;
use crate::unblock::unblock_file;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct MissingDependency {
    pub name: String,
    pub official_url: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstallReport {
    pub game_path: Option<String>,
    pub script_hook_v_found: bool,
    pub script_hook_v_dotnet_found: bool,
    pub dll_copied: bool,
    pub dll_version: Option<String>,
    pub unblocked: bool,
    pub ini_written: bool,
    pub missing_dependencies: Vec<MissingDependency>,
    pub warnings: Vec<String>,
}

const SCRIPT_HOOK_V_URL: &str = "http://www.dev-c.com/gtav/scripthookv/";
const SCRIPT_HOOK_V_DOTNET_URL: &str = "https://github.com/scripthookvdotnet/scripthookvdotnet/releases";

fn script_hook_v_present(game_path: &Path) -> bool {
    game_path.join("ScriptHookV.dll").is_file()
}

fn script_hook_v_dotnet_present(game_path: &Path) -> bool {
    // SHVDN Enhanced expone su runtime como ScriptHookVDotNet3.dll +
    // el loader ASI; comprobamos el más estable de los nombres conocidos.
    ["ScriptHookVDotNet3.dll", "ScriptHookVDotNet.asi", "ScriptHookVDotNet2.dll"]
        .iter()
        .any(|name| game_path.join(name).is_file())
}

fn default_ini_contents() -> &'static str {
    "; Generado por StreamTok — ver docs/CATALOGO.md del mod para más opciones\n\
[Debug]\n\
MenuEnabled=false\n\
\n\
[Arena]\n\
HealthTiers=25,50,75,100\n"
}

/// Ruta del marcador de versión instalada — archivo propio nuestro (no del
/// mod), escrito junto al `.dll` en cada instalación/actualización para que
/// la app sepa qué versión hay sin tener que leerla del binario.
fn version_marker_path(scripts_dir: &Path) -> PathBuf {
    scripts_dir.join(".streamtok-version")
}

pub fn installed_dll_path(game_path: &Path) -> PathBuf {
    game_path.join("scripts").join("StreamTok.GtaV.dll")
}

/// Versión instalada actualmente, si la hay (lee el marcador escrito en el
/// último `run_install`). `None` tanto si nunca se instaló como si el
/// marcador se perdió — en ese caso `installed_dll_path` sigue siendo la
/// señal real de "¿está instalado?".
pub fn installed_version(game_path: &Path) -> Option<String> {
    std::fs::read_to_string(version_marker_path(&game_path.join("scripts")))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Desinstala el mod: borra la DLL y nuestro marcador de versión.
///
/// Deliberadamente NO toca `StreamTok.GtaV.ini` — es config del usuario
/// (ej. `MenuEnabled`, `HealthTiers`) y borrarla de paso sería una sorpresa
/// desagradable si luego vuelve a instalar.
pub fn run_uninstall(game_path: &Path) -> Result<(), String> {
    let scripts_dir = game_path.join("scripts");
    let dll_path = installed_dll_path(game_path);

    if dll_path.is_file() {
        std::fs::remove_file(&dll_path)
            .map_err(|e| format!("No se pudo borrar StreamTok.GtaV.dll: {e}"))?;
    }

    // Best-effort: si el marcador no existe o no se puede borrar, no es un
    // error real — el mod ya quedó desinstalado (lo que importa es la DLL).
    let _ = std::fs::remove_file(version_marker_path(&scripts_dir));

    Ok(())
}

/// Punto de entrada llamado desde el comando de Tauri.
pub async fn run_install(explicit_game_path: Option<String>) -> Result<InstallReport, String> {
    let mut warnings = Vec::new();

    let game_path: Option<PathBuf> = match explicit_game_path {
        Some(p) => Some(PathBuf::from(p)),
        None => find_gta_v_install(),
    };

    let Some(game_path) = game_path else {
        return Ok(InstallReport {
            game_path: None,
            script_hook_v_found: false,
            script_hook_v_dotnet_found: false,
            dll_copied: false,
            dll_version: None,
            unblocked: false,
            ini_written: false,
            missing_dependencies: vec![],
            warnings: vec![
                "No se encontró la carpeta de GTA V automáticamente (Steam/Epic/Rockstar). \
                 Elige la carpeta manualmente (la que contiene GTA5.exe)."
                    .to_string(),
            ],
        });
    };

    if !game_path.join("GTA5.exe").is_file() {
        return Err(format!(
            "La carpeta {} no parece ser la de GTA V (no tiene GTA5.exe).",
            game_path.display()
        ));
    }

    let shv_found = script_hook_v_present(&game_path);
    let shvdn_found = script_hook_v_dotnet_present(&game_path);

    let mut missing_dependencies = Vec::new();
    if !shv_found {
        missing_dependencies.push(MissingDependency {
            name: "ScriptHookV".to_string(),
            official_url: SCRIPT_HOOK_V_URL.to_string(),
            reason: "Requerido por el mod; no se redistribuye — instálalo desde la web oficial de Alexander Blade.".to_string(),
        });
    }
    if !shvdn_found {
        missing_dependencies.push(MissingDependency {
            name: "ScriptHookVDotNet (Enhanced)".to_string(),
            official_url: SCRIPT_HOOK_V_DOTNET_URL.to_string(),
            reason: "Requerido por el mod (es C#); no se redistribuye — descárgalo del repo oficial.".to_string(),
        });
    }

    // Si falta alguna dependencia base, no seguimos copiando el mod: el
    // usuario primero debe instalar ScriptHookV/SHVDN, si no el juego ni
    // siquiera va a intentar cargar nuestra DLL.
    if !missing_dependencies.is_empty() {
        return Ok(InstallReport {
            game_path: Some(game_path.display().to_string()),
            script_hook_v_found: shv_found,
            script_hook_v_dotnet_found: shvdn_found,
            dll_copied: false,
            dll_version: None,
            unblocked: false,
            ini_written: false,
            missing_dependencies,
            warnings,
        });
    }

    let scripts_dir = game_path.join("scripts");
    if !scripts_dir.is_dir() {
        std::fs::create_dir_all(&scripts_dir)
            .map_err(|e| format!("No se pudo crear la carpeta scripts\\: {e}"))?;
    }

    let fetched = fetch_latest_dll().await?;
    let dll_path = scripts_dir.join("StreamTok.GtaV.dll");
    std::fs::write(&dll_path, &fetched.bytes)
        .map_err(|e| format!("No se pudo copiar StreamTok.GtaV.dll: {e}"))?;

    let unblocked = match unblock_file(&dll_path) {
        Ok(()) => true,
        Err(e) => {
            warnings.push(format!(
                "No se pudo desbloquear el archivo automáticamente ({e}). \
                 Si el mod no carga, click derecho → Propiedades → Desbloquear."
            ));
            false
        }
    };

    let ini_path = scripts_dir.join("StreamTok.GtaV.ini");
    let ini_written = if ini_path.is_file() {
        // No pisamos una config que el usuario ya haya tocado.
        warnings.push("Ya existía StreamTok.GtaV.ini; se dejó sin cambios.".to_string());
        false
    } else {
        match std::fs::write(&ini_path, default_ini_contents()) {
            Ok(()) => true,
            Err(e) => {
                warnings.push(format!("No se pudo escribir StreamTok.GtaV.ini: {e}"));
                false
            }
        }
    };

    // Best-effort: si falla, no es grave — get_mod_status simplemente no va
    // a poder comparar versión instalada vs última hasta la próxima vez que
    // esto corra bien.
    let _ = std::fs::write(version_marker_path(&scripts_dir), &fetched.version);

    Ok(InstallReport {
        game_path: Some(game_path.display().to_string()),
        script_hook_v_found: shv_found,
        script_hook_v_dotnet_found: shvdn_found,
        dll_copied: true,
        dll_version: Some(fetched.version),
        unblocked,
        ini_written,
        missing_dependencies: vec![],
        warnings,
    })
}
