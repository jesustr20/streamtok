import type { GiftCatalogEntry, GiftCatalogMessage } from "@streamtok/shared";
import { useEffect, useState } from "react";
import type { SidecarClient } from "./ws-client";

// Último catálogo recibido: al volver a la pantalla la lista ya está y no parpadea.
let last: GiftCatalogEntry[] = [];

/** Catálogo de regalos aprendido (canal WS `gift-catalog`), para elegir regalos de una lista. */
export function useGiftCatalog(client: SidecarClient | null): GiftCatalogEntry[] {
  const [gifts, setGifts] = useState<GiftCatalogEntry[]>(last);
  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "gift-catalog") return;
      const msg = evt.payload as GiftCatalogMessage;
      if (msg.kind === "state") {
        last = msg.gifts;
        setGifts(msg.gifts);
      }
    });
    client.send("gift-catalog", { kind: "get-state" });
    return off;
  }, [client]);
  return gifts;
}
