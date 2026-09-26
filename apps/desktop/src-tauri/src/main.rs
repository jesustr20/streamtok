#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod github_release;
mod gta_locate;
mod install_mod;
mod unblock;

use install_mod::InstallReport;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn install_gta_v_mod(game_path: Option<String>) -> Result<InstallReport, String> {
    install_mod::run_install(game_path).await
}

#[tauri::command]
fn find_gta_v_path() -> Option<String> {
    gta_locate::find_gta_v_install().map(|p| p.display().to_string())
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
        ])
        .run(tauri::generate_context!())
        .expect("error corriendo la app de StreamTok");
}
