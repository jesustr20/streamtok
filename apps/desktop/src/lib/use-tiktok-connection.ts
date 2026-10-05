import type { TiktokConnectionMessage, TiktokConnectionState } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

const STORAGE_KEY = "streamtok.lastTiktokUsername";

function readRemembered(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeRemembered(username: string) {
  try {
    localStorage.setItem(STORAGE_KEY, username);
  } catch {
    // Sin almacenamiento disponible: solo se pierde el recordatorio.
  }
}

const IDLE: TiktokConnectionState = { status: "idle", recordedEvents: 0 };

/**
 * Estado de la conexión al LIVE de TikTok (canal WS `tiktok-connection`) para
 * las pantallas que lo muestran (Inicio y el menú lateral).
 *
 * - `conn`: estado vigente que reporta el sidecar.
 * - `lastUsername`: último usuario con el que se conectó (se recuerda entre
 *   sesiones), para mostrar la cuenta aunque ahora esté desconectado.
 */
export function useTiktokConnection(client: SidecarClient | null): {
  conn: TiktokConnectionState;
  lastUsername: string;
} {
  const [conn, setConn] = useState<TiktokConnectionState>(IDLE);
  const [lastUsername, setLastUsername] = useState(readRemembered);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "tiktok-connection") return;
      const msg = evt.payload as TiktokConnectionMessage;
      if (msg.kind !== "state") return;
      setConn(msg.state);
      // Solo se recuerdan los usuarios con los que se llegó a conectar.
      if (msg.state.status === "connected" && msg.state.username) {
        writeRemembered(msg.state.username);
        setLastUsername(msg.state.username);
      }
    });
    // Snapshot bajo demanda: el estado inicial pudo llegar antes de montar.
    client.send("tiktok-connection", { kind: "get-state" });
    return off;
  }, [client]);

  return { conn, lastUsername };
}
