import type { EmoteCatalogEntry, EmoteCatalogMessage } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

// Último catálogo recibido: al volver a la pantalla la lista ya está y no parpadea.
let last: EmoteCatalogEntry[] = [];

/** Catálogo de stickers y emotes aprendido (canal WS `emote-catalog`), para elegirlos de una lista. */
export function useEmoteCatalog(client: SidecarClient | null): EmoteCatalogEntry[] {
  const [emotes, setEmotes] = useState<EmoteCatalogEntry[]>(last);
  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "emote-catalog") return;
      const msg = evt.payload as EmoteCatalogMessage;
      if (msg.kind === "state") {
        last = msg.emotes;
        setEmotes(msg.emotes);
      }
    });
    client.send("emote-catalog", { kind: "get-state" });
    return off;
  }, [client]);
  return emotes;
}
