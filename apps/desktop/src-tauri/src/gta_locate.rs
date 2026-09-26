//! Detección de la carpeta de instalación de GTA V (Steam / Epic / Rockstar
//! Games Launcher), según el punto 5 del contrato:
//! "detectar carpeta del juego (Steam/Epic/Rockstar)".
//!
//! Estrategia: cada launcher guarda sus rutas de instalación en un archivo
//! de manifiesto propio. Los parseamos de forma tolerante (no dependemos de
//! un parser de VDF completo) buscando el patrón de "install dir" y
//! confirmando que la carpeta candidata contenga GTA5.exe.

use std::path::{Path, PathBuf};

pub fn find_gta_v_install() -> Option<PathBuf> {
    for candidate in steam_candidates()
        .into_iter()
        .chain(epic_candidates())
        .chain(rockstar_candidates())
    {
        if is_gta_v_folder(&candidate) {
            return Some(candidate);
        }
    }
    None
}

pub fn is_gta_v_folder(path: &Path) -> bool {
    path.join("GTA5.exe").is_file()
}

fn program_files_x86() -> Option<PathBuf> {
    std::env::var_os("ProgramFiles(x86)").map(PathBuf::from)
}

fn program_files() -> Option<PathBuf> {
    std::env::var_os("ProgramFiles").map(PathBuf::from)
}

/// Busca en las steamapps/common de todas las "library folders" declaradas
/// en libraryfolders.vdf, además de la instalación por defecto de Steam.
fn steam_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(pf86) = program_files_x86() else { return out; };
    let steam_root = pf86.join("Steam");
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");

    // instalación por defecto
    out.push(steam_root.join("steamapps").join("common").join("Grand Theft Auto V"));
    out.push(
        steam_root
            .join("steamapps")
            .join("common")
            .join("Grand Theft Auto V Legacy"),
    );

    if let Ok(contents) = std::fs::read_to_string(&vdf_path) {
        for lib_path in parse_vdf_paths(&contents) {
            out.push(
                PathBuf::from(&lib_path)
                    .join("steamapps")
                    .join("common")
                    .join("Grand Theft Auto V"),
            );
            out.push(
                PathBuf::from(&lib_path)
                    .join("steamapps")
                    .join("common")
                    .join("Grand Theft Auto V Legacy"),
            );
        }
    }
    out
}

/// Parser tolerante de VDF: extrae cualquier valor de clave `"path"` sin
/// implementar el formato completo (alcanza para libraryfolders.vdf).
fn parse_vdf_paths(contents: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("\"path\"") {
            if let Some(value) = extract_quoted_value(rest) {
                paths.push(value.replace("\\\\", "\\"));
            }
        }
    }
    paths
}

fn extract_quoted_value(rest: &str) -> Option<String> {
    let start = rest.find('"')? + 1;
    let end = rest[start..].find('"')? + start;
    Some(rest[start..end].to_string())
}

fn epic_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    // Epic guarda manifiestos .item en ProgramData\Epic\EpicGamesLauncher\Data\Manifests
    if let Some(program_data) = std::env::var_os("ProgramData").map(PathBuf::from) {
        let manifests = program_data
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests");
        if let Ok(entries) = std::fs::read_dir(&manifests) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("item") {
                    continue;
                }
                if let Ok(text) = std::fs::read_to_string(&path) {
                    if text.contains("\"AppName\": \"9d2d0eb64d5c44529cece33fe2a46482\"")
                        || text.to_lowercase().contains("grand theft auto v")
                    {
                        if let Some(install_location) = extract_json_string(&text, "InstallLocation") {
                            out.push(PathBuf::from(install_location));
                        }
                    }
                }
            }
        }
    }
    out
}

fn extract_json_string(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let idx = text.find(&needle)?;
    let rest = &text[idx + needle.len()..];
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let start = after_colon.find('"')? + 1;
    let end = after_colon[start..].find('"')? + start;
    Some(after_colon[start..end].replace("\\\\", "\\"))
}

fn rockstar_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(pf) = program_files() {
        out.push(pf.join("Rockstar Games").join("Grand Theft Auto V"));
    }
    if let Some(pf86) = program_files_x86() {
        out.push(pf86.join("Rockstar Games").join("Grand Theft Auto V"));
    }
    out
}
