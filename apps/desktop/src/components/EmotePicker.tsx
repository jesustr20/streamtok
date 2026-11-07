import { Fragment, useState } from "react";
import type { EmoteCatalogEntry, LiveEventEmoteSceneT } from "@streamtok/shared";
import {
  giftDropdownStyle,
  giftGroupHeaderStyle,
  giftNameStyle,
  giftOptionStyle,
  giftPickerButtonStyle,
  giftSearchStyle,
  giftSubtitleStyle,
  giftTextColumnStyle,
  giftThumbStyle,
} from "./GiftPicker";

/** Nombre del origen. TikTok aún llama `SUBSCRIPTION` a lo que ahora se llama Super Fan (ADR 0018). */
export const EMOTE_SCENE_LABEL: Record<LiveEventEmoteSceneT, string> = {
  fanClub: "Club de fans",
  subscriber: "Super Fan",
};

/** Qué sticker/emote dispara el Evento: sin `id` = cualquiera (del origen elegido, o de todos). */
export interface EmoteRef {
  id?: string;
  scene?: LiveEventEmoteSceneT;
}

interface Option {
  key: string;
  ref: EmoteRef;
  title: string;
  subtitle: string;
  imageUrl?: string;
}

const entryTitle = (e: { scene: LiveEventEmoteSceneT }) =>
  e.scene === "fanClub" ? "Sticker del Club de fans" : "Emote de Super Fan";

function anyOption(scene?: LiveEventEmoteSceneT): Option {
  return {
    key: `any|${scene ?? ""}`,
    ref: { scene },
    title: scene ? `Cualquiera de ${EMOTE_SCENE_LABEL[scene]}` : "Cualquier sticker o emote",
    subtitle: scene ? "Sin elegir uno en concreto" : "De cualquier origen",
  };
}

function entryOption(e: EmoteCatalogEntry): Option {
  return {
    key: `id|${e.id}`,
    ref: { id: e.id, scene: e.scene },
    title: entryTitle(e),
    subtitle: `ID:${e.id}`,
    imageUrl: e.imageUrl,
  };
}

/** Opción que corresponde a lo guardado en el Evento (aunque el sticker ya no esté en el catálogo). */
export function optionFor(value: EmoteRef, emotes: EmoteCatalogEntry[]): Option {
  if (value.id) {
    const found = emotes.find((e) => e.id === value.id);
    if (found) return entryOption(found);
    return {
      key: `id|${value.id}`,
      ref: value,
      title: value.scene ? entryTitle({ scene: value.scene }) : "Sticker o emote",
      subtitle: `ID:${value.id}`,
    };
  }
  return anyOption(value.scene);
}

/** Miniatura que no rompe la lista si la imagen no carga (las URLs de TikTok pueden caducar). */
function Thumb({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        style={{
          ...giftThumbStyle,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px dashed #2A2C33",
          color: "#5B5D66",
          fontSize: 14,
        }}
      >
        ✱
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      style={giftThumbStyle}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Selector de sticker o emote del streamer (ADR 0018): misma lista desplegable con buscador que
 * el de regalos. Arriba, los atajos "Cualquiera…"; abajo, los que ya llegaron por un LIVE.
 */
export function EmotePicker({
  value,
  emotes,
  onSelect,
}: {
  value: EmoteRef;
  emotes: EmoteCatalogEntry[];
  onSelect: (ref: EmoteRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = optionFor(value, emotes);

  const q = query.trim().toLowerCase();
  const matches = (o: Option) =>
    !q || o.title.toLowerCase().includes(q) || o.subtitle.toLowerCase().includes(q);

  const anyOptions = [anyOption(), anyOption("fanClub"), anyOption("subscriber")].filter(matches);
  const groups = (["fanClub", "subscriber"] as const)
    .map((scene) => ({
      scene,
      options: emotes
        .filter((e) => e.scene === scene)
        .map(entryOption)
        .filter(matches),
    }))
    .filter((g) => g.options.length > 0);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function renderOption(o: Option) {
    const isSelected = o.key === selected.key;
    return (
      <button
        key={o.key}
        type="button"
        onClick={() => {
          onSelect(o.ref);
          close();
        }}
        style={{ ...giftOptionStyle, background: isSelected ? "#1E2027" : "transparent" }}
      >
        <Thumb url={o.imageUrl} />
        <span style={giftTextColumnStyle}>
          <span style={{ ...giftNameStyle, color: isSelected ? "#F4F4F5" : "#C4C5CC" }}>{o.title}</span>
          <span style={giftSubtitleStyle}>{o.subtitle}</span>
        </span>
      </button>
    );
  }

  const nothing = anyOptions.length === 0 && groups.length === 0;

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={giftPickerButtonStyle}>
        <Thumb url={selected.imageUrl} />
        <span style={giftTextColumnStyle}>
          <span style={giftNameStyle}>{selected.title}</span>
          <span style={giftSubtitleStyle}>{selected.subtitle}</span>
        </span>
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>
      {emotes.length === 0 && (
        <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: "#5B5D66" }}>
          Aún no hay stickers ni emotes aprendidos. Cuando alguien envíe uno en un LIVE aparecerá en esta
          lista con su imagen. Mientras tanto, “Cualquier sticker o emote” dispara con todos.
        </div>
      )}

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={close} />
          <div style={giftDropdownStyle}>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              style={giftSearchStyle}
            />
            {nothing ? (
              <div style={{ padding: "10px 8px", fontSize: 12, color: "#5B5D66" }}>Nada coincide.</div>
            ) : (
              <>
                {anyOptions.map(renderOption)}
                {groups.map((g) => (
                  <Fragment key={g.scene}>
                    <div style={giftGroupHeaderStyle}>
                      {EMOTE_SCENE_LABEL[g.scene]} ({g.options.length})
                    </div>
                    {g.options.map(renderOption)}
                  </Fragment>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
