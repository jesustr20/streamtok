import { MEDIA_MAX_BYTES, type MediaFile, type MediaMessage, type MediaShowParams, type MediaWebItem } from "@streamtok/shared";
import { useEffect, useState } from "react";
import { toBase64 } from "./use-audio";
import type { SidecarClient } from "./ws-client";

/** Última lista recibida (módulo): al abrir el panel la lista ya está y no parpadea. */
let last: { files: MediaFile[]; web: MediaWebItem[]; dir: string; port: number } = { files: [], web: [], dir: "", port: 7340 };

export function mediaFileUrl(port: number, name: string): string {
  return `http://localhost:${port}/media/${encodeURIComponent(name)}`;
}

/**
 * Dirección de la pantalla `n` para pegar como fuente de enlace en TikTok LIVE Studio.
 * LIVE Studio rechaza "localhost" y "127.0.0.1" (ADR 0011): se usa `127.0.0.1.nip.io`, que resuelve a 127.0.0.1,
 * igual que los demás overlays. Con `obs` sale la versión `localhost` (OBS sí la acepta).
 */
export function screenOverlayUrl(port: number, n: number, obs = false): string {
  return `http://${obs ? "localhost" : "127.0.0.1.nip.io"}:${port}/overlay/pantalla/${n}`;
}

/** Biblioteca de medios del sidecar (canal WS `media`). */
export function useMediaLibrary(client: SidecarClient | null) {
  const [state, setState] = useState(last);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "media") return;
      const msg = evt.payload as MediaMessage;
      if (msg.kind === "state") {
        last = { files: msg.files, web: msg.web, dir: msg.dir, port: msg.port };
        setState(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("media", { kind: "get-state" });
    return off;
  }, [client]);
  return { ...state, error, clearError: () => setError(null) };
}

/** Manda un archivo al sidecar para guardarlo en la carpeta de medios. Devuelve un mensaje si no sirve. */
export async function uploadMediaFile(client: SidecarClient, file: File): Promise<string | null> {
  if (file.size > MEDIA_MAX_BYTES) return `"${file.name}" pesa más de ${Math.round(MEDIA_MAX_BYTES / 1024 / 1024)} MB.`;
  client.send("media", { kind: "upload", name: file.name, data: toBase64(await file.arrayBuffer()) });
  return null;
}

/** Pide al sidecar que lo muestre (por el mismo camino que una Acción): sirve para probar la pantalla. */
export function requestMediaShow(client: SidecarClient, params: MediaShowParams): void {
  client.send("media", { kind: "show", ...params });
}
