import type { TiktokConnectionMessage, TiktokConnectionState } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

const STORAGE_KEY = "streamtok.lastTiktokAccount";
const LEGACY_KEY = "streamtok.lastTiktokUsername";

/** Última cuenta con la que se conectó (se recuerda entre sesiones). */
export type RememberedAccount = { username: string; nickname?: string; avatarUrl?: string };

function readRemembered(): RememberedAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as RememberedAccount;
      if (v && typeof v.username === "string" && v.username) return v;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy ? { username: legacy } : null;
  } catch {
    return null;
  }
}

function writeRemembered(account: RememberedAccount) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
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
 * - `account`: esa misma cuenta con su nombre y foto (si TikTok los entregó).
 */
export function useTiktokConnection(client: SidecarClient | null): {
  conn: TiktokConnectionState;
  lastUsername: string;
  account: RememberedAccount | null;
} {
  const [conn, setConn] = useState<TiktokConnectionState>(IDLE);
  const [account, setAccount] = useState<RememberedAccount | null>(readRemembered);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "tiktok-connection") return;
      const msg = evt.payload as TiktokConnectionMessage;
      if (msg.kind !== "state") return;
      setConn(msg.state);
      // Solo se recuerdan los usuarios con los que se llegó a conectar.
      if (msg.state.status === "connected" && msg.state.username) {
        const next: RememberedAccount = {
          username: msg.state.username,
          ...(msg.state.nickname ? { nickname: msg.state.nickname } : {}),
          ...(msg.state.avatarUrl ? { avatarUrl: msg.state.avatarUrl } : {}),
        };
        writeRemembered(next);
        setAccount(next);
      }
    });
    // Snapshot bajo demanda: el estado inicial pudo llegar antes de montar.
    client.send("tiktok-connection", { kind: "get-state" });
    return off;
  }, [client]);

  return { conn, lastUsername: account?.username ?? "", account };
}
