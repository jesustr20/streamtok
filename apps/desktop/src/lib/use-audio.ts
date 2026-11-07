import { AudioScheduler, AUDIO_MAX_BYTES, type AudioFile, type AudioMessage, type AudioPlayParams } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

/** Última lista recibida (módulo): al abrir el modal la lista ya está y no parpadea. */
let last: { files: AudioFile[]; dir: string; port: number } = { files: [], dir: "", port: 7340 };

export function audioFileUrl(port: number, name: string): string {
  return `http://localhost:${port}/audios/${encodeURIComponent(name)}`;
}

export function currentAudioPort(): number {
  return last.port;
}

/** Biblioteca de audios del sidecar (canal WS `audio`). */
export function useAudioLibrary(client: SidecarClient | null) {
  const [state, setState] = useState(last);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "audio") return;
      const msg = evt.payload as AudioMessage;
      if (msg.kind === "state") {
        last = { files: msg.files, dir: msg.dir, port: msg.port };
        setState(last);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    client.send("audio", { kind: "get-state" });
    return off;
  }, [client]);
  return { ...state, error, clearError: () => setError(null) };
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Manda un archivo al sidecar para guardarlo en la carpeta de audios. Devuelve un mensaje si no sirve. */
export async function uploadAudioFile(client: SidecarClient, file: File): Promise<string | null> {
  if (file.size > AUDIO_MAX_BYTES) return `"${file.name}" pesa más de ${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)} MB.`;
  client.send("audio", { kind: "upload", name: file.name, data: toBase64(await file.arrayBuffer()) });
  return null;
}

/** Pide al sidecar que "reproduzca" (el reproductor de la app lo recibe): sirve para probar el camino completo. */
export function requestAudioPlay(client: SidecarClient, params: AudioPlayParams): void {
  client.send("audio", { kind: "play", ...params });
}

/**
 * Reproductor de la app (ADR 0019): suena lo que el sidecar avisa por `audio`/`play`.
 * Se monta una sola vez en la raíz de la app. Devuelve el último error (p. ej. el
 * navegador bloqueó el sonido hasta que haya un clic en la app).
 */
export function useAudioPlayer(client: SidecarClient | null): { error: string | null; dismiss: () => void } {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    const scheduler = new AudioScheduler(
      (file) => new Audio(audioFileUrl(last.port, file)),
      (message, err) => {
        const blocked = err instanceof DOMException && err.name === "NotAllowedError";
        setError(blocked ? "El sonido está bloqueado: haz clic en cualquier parte de la app y vuelve a probar." : message);
      },
    );
    const off = client.on((evt) => {
      if (evt.channel !== "audio") return;
      const msg = evt.payload as AudioMessage;
      if (msg.kind === "play") {
        const { kind: _kind, ...params } = msg;
        scheduler.play(params);
      }
    });
    return () => {
      off();
      scheduler.stopAll();
    };
  }, [client]);
  return { error, dismiss: () => setError(null) };
}
