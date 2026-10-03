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

/// Consulta `/releases/latest` (sin descargar ningún asset) — compartido por
/// `fetch_latest_dll` y `fetch_latest_version`, para no repetir la misma
/// llamada en dos lados.
async fn fetch_latest_release(client: &reqwest::Client) -> Result<GithubRelease, String> {
    let api_url = format!("https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases/latest");
    client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo consultar la última Release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub respondió con error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Respuesta de GitHub inesperada: {e}"))
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("StreamTok-Desktop")
        .build()
        .map_err(|e| e.to_string())
}

/// Solo el tag de la última Release (sin `v` al inicio), para comparar contra
/// la versión instalada sin tener que bajar el `.zip` completo.
pub async fn fetch_latest_version() -> Result<String, String> {
    let client = http_client()?;
    let release = fetch_latest_release(&client).await?;
    Ok(release.tag_name.trim_start_matches('v').to_string())
}

/// Descarga el Release más reciente y devuelve los bytes de
/// `scripts\StreamTok.GtaV.dll` ya extraídos del zip.
pub async fn fetch_latest_dll() -> Result<FetchedDll, String> {
    let client = http_client()?;
    let release = fetch_latest_release(&client).await?;

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

/// Ruta del catálogo de acciones cacheado localmente (ver ADR 0006). Es un
/// cache reemplazable, no la fuente de verdad: la fuente real es el Release
/// de GitHub y, mientras el mod esté conectado, el `mod-hello` en vivo.
pub fn catalog_cache_path() -> PathBuf {
    cache_dir().join("catalog.json")
}

/// Descarga el `catalog.json` publicado como asset del último Release
/// (ver ADR 0006 — mismo repo/Release que `fetch_latest_dll`, no re-pega la
/// request: el caller decide si también quiere el `.dll`). Devuelve el JSON
/// crudo, sin parsear — la validación contra `ModHelloPayloadSchema` es en
/// TS (`@streamtok/shared`), acá solo se transporta el string.
pub async fn fetch_latest_catalog() -> Result<String, String> {
    let client = http_client()?;
    let release = fetch_latest_release(&client).await?;

    let asset = release
        .assets
        .iter()
        .find(|a| a.name == "catalog.json")
        .ok_or_else(|| "La Release no tiene un asset catalog.json".to_string())?;

    client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar catalog.json: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// Lee el catálogo cacheado en disco, si existe (ver ADR 0006).
pub fn read_cached_catalog() -> Option<String> {
    std::fs::read_to_string(catalog_cache_path()).ok()
}

/// Pisa el cache en disco con un JSON de catálogo nuevo (viene de un Release
/// recién bajado, o del `mod-hello` en vivo — ambos son fuente autoritativa,
/// ver ADR 0006). El caller ya validó el shape en TS antes de llegar acá.
pub fn write_cached_catalog(json: &str) -> Result<(), String> {
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el cache dir: {e}"))?;
    std::fs::write(catalog_cache_path(), json)
        .map_err(|e| format!("No se pudo escribir catalog.json en cache: {e}"))
}
