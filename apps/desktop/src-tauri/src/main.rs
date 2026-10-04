#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod github_release;
mod gta_locate;
mod install_mod;
mod unblock;

use install_mod::InstallReport;
use serde::Serialize;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn install_gta_v_mod(game_path: Option<String>) -> Result<InstallReport, String> {
    install_mod::run_install(game_path).await
}

#[tauri::command]
fn find_gta_v_path() -> Option<String> {
    gta_locate::find_gta_v_install().map(|p| p.display().to_string())
}

#[derive(Debug, Serialize, Clone)]
struct ModStatus {
    game_path: Option<String>,
    installed: bool,
    installed_version: Option<String>,
    latest_version: Option<String>,
    update_available: bool,
}

/// Resuelve el path explícito o detectado, sin exigir que sea válido (eso lo
/// decide `installed`/`installed_version`, que simplemente serán `false`/
/// `None` si la carpeta no tiene nada instalado).
fn resolve_game_path(explicit_game_path: Option<String>) -> Option<PathBuf> {
    match explicit_game_path {
        Some(p) => Some(PathBuf::from(p)),
        None => gta_locate::find_gta_v_install(),
    }
}

#[tauri::command]
async fn get_mod_status(game_path: Option<String>) -> Result<ModStatus, String> {
    let resolved = resolve_game_path(game_path);

    let Some(resolved) = resolved else {
        return Ok(ModStatus {
            game_path: None,
            installed: false,
            installed_version: None,
            latest_version: None,
            update_available: false,
        });
    };

    let installed = install_mod::installed_dll_path(&resolved).is_file();
    let installed_version = install_mod::installed_version(&resolved);

    // La versión más nueva es "best-effort": si no hay internet o GitHub no
    // responde, igual queremos mostrar el estado de instalación conocido en
    // vez de tirar un error que bloquee toda la sección.
    let latest_version = github_release::fetch_latest_version().await.ok();

    let update_available = match (&installed_version, &latest_version) {
        (Some(current), Some(latest)) => current != latest,
        _ => false,
    };

    Ok(ModStatus {
        game_path: Some(resolved.display().to_string()),
        installed,
        installed_version,
        latest_version,
        update_available,
    })
}

#[tauri::command]
async fn uninstall_gta_v_mod(game_path: String) -> Result<(), String> {
    install_mod::run_uninstall(std::path::Path::new(&game_path))
}

#[tauri::command]
async fn pick_gta_v_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|f| f.to_string()));
    });
    rx.await.ok().flatten()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            install_gta_v_mod,
            find_gta_v_path,
            pick_gta_v_folder,
            get_mod_status,
            uninstall_gta_v_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error corriendo la app de StreamTok");
}
