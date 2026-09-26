//! "Desbloquear" un archivo descargado de internet en Windows = borrar el
//! alternate data stream NTFS `Zone.Identifier` que el sistema le agrega
//! (es el mismo flag que revisa/limpia el botón "Desbloquear" de las
//! Propiedades de un archivo, o `Unblock-File` en PowerShell). Si no se
//! quita, ScriptHookV/SHVDN pueden negarse a cargar la DLL.

use std::io;
use std::path::Path;

#[cfg(target_os = "windows")]
pub fn unblock_file(path: &Path) -> io::Result<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::Storage::FileSystem::DeleteFileW;

    let mut ads: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(OsStr::new(":Zone.Identifier").encode_wide())
        .collect();
    ads.push(0);

    unsafe {
        let result = DeleteFileW(PCWSTR(ads.as_ptr()));
        match result {
            Ok(()) => Ok(()),
            Err(err) => {
                // ERROR_FILE_NOT_FOUND (2) = el alternate data stream
                // Zone.Identifier no existe → el archivo ya estaba
                // desbloqueado, no es un error real. DeleteFileW envuelve el
                // código de error Win32 en un HRESULT (HRESULT_FROM_WIN32),
                // por eso se compara contra esa representación y no contra `2`.
                if err.code() == windows::core::HRESULT::from_win32(ERROR_FILE_NOT_FOUND.0) {
                    Ok(())
                } else {
                    Err(io::Error::from_raw_os_error(err.code().0))
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn unblock_file(_path: &Path) -> io::Result<()> {
    // No aplica fuera de Windows (GTA V + ScriptHookV son Windows-only).
    Ok(())
}
