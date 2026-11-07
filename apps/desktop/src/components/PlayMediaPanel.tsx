import { useEffect, useRef, useState } from "react";
import { mediaKindOf, type MediaShowParams } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { requestMediaShow, uploadMediaFile, useMediaLibrary } from "../lib/use-media";
import { MediaLibraryModal } from "./MediaLibraryModal";

const ACCENT = "#E23A57";

/**
 * Panel de la acción general «Mostrar IMG / GIF / VIDEO» (ADR 0022), igual que el de Play Audio:
 * tamaño, duración y volumen aquí; «Abrir lista de medios» abre el modal con las pestañas
 * Archivos locales / Archivos web / Imágenes App. «Subir archivo» sube y deja elegido el archivo.
 */
export function PlayMediaPanel({
  client,
  value,
  onChange,
}: {
  client: SidecarClient | null;
  value: MediaShowParams;
  onChange: (next: MediaShowParams) => void;
}) {
  const { files, error, clearError } = useMediaLibrary(client);
  const [listOpen, setListOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Archivos que había al subir: el que aparezca de más es el que se acaba de subir y se elige solo.
  const before = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!before.current) return;
    const added = files.filter((f) => !before.current!.has(f.name));
    if (added.length > 0) {
      onChange({ ...value, source: "local", file: added[added.length - 1].name, url: "" });
      before.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  async function upload(list: FileList | File[]) {
    if (!client) return;
    setLocalError(null);
    clearError();
    before.current = new Set(files.map((f) => f.name));
    for (const f of Array.from(list)) {
      const err = await uploadMediaFile(client, f);
      if (err) {
        setLocalError(err);
        before.current = null;
      }
    }
  }

  const chosen = value.source === "web" ? value.url : value.file;
  const missing = value.source === "local" && value.file !== "" && !files.some((f) => f.name === value.file) && files.length > 0;
  const isVideo = mediaKindOf(value.source === "web" ? value.url.split("?")[0] : value.file) === "video";
  const shownError = localError ?? error;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#9A9CA5" }}>Medio:</span>
        <span
          title={chosen}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 700,
            color: chosen ? (missing ? "#F2776F" : "#F4F4F5") : "#5B5D66",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {chosen || "Ninguno elegido"}
          {missing ? " (ya no está en la carpeta)" : ""}
        </span>
        <button
          type="button"
          disabled={!client || !chosen || missing}
          onClick={() => client && requestMediaShow(client, value)}
          style={{ ...smallButtonStyle, opacity: !chosen || missing ? 0.4 : 1 }}
          title="Lo muestra en la pantalla igual que cuando lo dispare un evento"
        >
          ▶ Probar
        </button>
      </div>

      <Slider label={`Tamaño: ${value.sizePct} %`} min={10} max={100} value={value.sizePct} onChange={(v) => onChange({ ...value, sizePct: v })} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5", flexWrap: "wrap" }}>
        <span style={{ minWidth: 86 }}>Duración (seg):</span>
        <input
          type="number"
          min={0}
          max={600}
          value={value.durationSec}
          onChange={(e) => onChange({ ...value, durationSec: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
          style={{ ...inputStyle, width: 80 }}
        />
        <span style={{ fontSize: 11 }}>0 = automática (imagen 5 s · video hasta que termine)</span>
      </div>

      <Slider label={`Volumen: ${value.volume}`} min={0} max={100} value={value.volume} onChange={(v) => onChange({ ...value, volume: v })} dim={!isVideo} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <button type="button" onClick={() => setListOpen(true)} style={buttonStyle}>
          Abrir lista de medios
        </button>
        <button
          type="button"
          title="Elige una imagen, GIF o video de tu PC: se copia a la carpeta de medios y queda elegido"
          onClick={() => fileInput.current?.click()}
          style={buttonStyle}
        >
          Subir archivo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.mp4,.webm,.mov,image/*,video/mp4,video/webm,video/quicktime"
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
          style={{
            flex: 1,
            minWidth: 140,
            minHeight: 36,
            border: `1px dashed ${drag ? ACCENT : "#2A2C33"}`,
            borderRadius: 9,
            padding: "6px 12px",
            fontSize: 11.5,
            color: drag ? "#fff" : "#9A9CA5",
            display: "flex",
            alignItems: "center",
          }}
        >
          o suéltalo aquí (imagen, GIF o video)
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: "#5B5D66", lineHeight: 1.4 }}>
        Se muestra en la pantalla {value.screen}. Su dirección para TikTok LIVE Studio está en «Abrir lista de medios» → «Archivos web».
      </div>

      {shownError && <div style={{ fontSize: 11.5, color: "#F2776F" }}>{shownError}</div>}

      {listOpen && <MediaLibraryModal client={client} value={value} onChange={onChange} onClose={() => setListOpen(false)} />}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  dim,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  dim?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5", opacity: dim ? 0.45 : 1 }}>
      <span style={{ minWidth: 86 }}>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: ACCENT }} />
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  margin: "4px 14px 12px 40px",
  padding: 14,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const inputStyle: React.CSSProperties = {
  height: 32,
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  padding: "0 10px",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#F4F4F5",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const smallButtonStyle: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};
