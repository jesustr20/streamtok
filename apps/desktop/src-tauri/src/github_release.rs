//! Descarga la última Release del repo del mod (`streamtok-mod-gtav`) y
//! extrae `scripts\StreamTok.GtaV.dll` del zip `StreamTok.GtaV-vX.Y.Z.zip`.
//!
//! Esto es NUESTRA propia DLL — no ScriptHookV ni ScriptHookVDotNet, esos
//! dos el contrato dice explícitamente que "no se pueden redistribuir" y
//! por eso nunca los tocamos acá, solo verificamos que ya estén instalados.

use serde::Deserialize;
use std::io::Cursor;
use std::path::PathBuf;

const REPO_OWNER: &str = "jesustr20";
const REPO_NAME: &str = "streamtok-mod-gtav";

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

pub struct FetchedDll {
    pub version: String,
    pub bytes: Vec<u8>,
}

/// Descarga el Release más reciente y devuelve los bytes de
/// `scripts\StreamTok.GtaV.dll` ya extraídos del zip.
pub async fn fetch_latest_dll() -> Result<FetchedDll, String> {
    let client = reqwest::Client::builder()
        .user_agent("StreamTok-Desktop")
        .build()
        .map_err(|e| e.to_string())?;

    let api_url = format!("https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest");
    let release: GithubRelease = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar la última Release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub respondió con error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta de GitHub inesperada: {e}"))?;

    let asset = release
        .assets
        .iter()
        .find(|a| a.name.starts_with("StreamTok.GtaV") && a.name.ends_with(".zip"))
        .ok_or_else(|| "La Release no tiene un asset StreamTok.GtaV-*.zip".to_string())?;

    let zip_bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar el zip del mod: {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| format!("Zip inválido: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().replace('\\', "/");
        if name.ends_with("scripts/StreamTok.GtaV.dll") || name == "StreamTok.GtaV.dll" {
            let mut bytes = Vec::new();
            std::io::copy(&mut file, &mut bytes).map_err(|e| e.to_string())?;
            return Ok(FetchedDll {
                version: release.tag_name.trim_start_matches('v').to_string(),
                bytes,
            });
        }
    }

    Err("El zip de la Release no contiene scripts\\StreamTok.GtaV.dll".to_string())
}

pub fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("StreamTok")
}
