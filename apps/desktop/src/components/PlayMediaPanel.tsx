import { useEffect, useRef, useState } from "react";
import { MEDIA_MAX_SCREENS, mediaKindOf, parseMediaUrl, type MediaShowParams } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { mediaFileUrl, requestMediaShow, screenOverlayUrl, uploadMediaFile, useMediaLibrary } from "../lib/use-media";

const ACCENT = "#E23A57";
type Tab = "local" | "web" | "app";

/**
 * Panel de la acción general «Mostrar IMG / GIF / VIDEO» (ADR 0022), con el mismo orden que
 * Interactive: tamaño, duración, volumen, subir archivo y las pestañas Archivos locales /
 * Archivos web / Imágenes App. Lo que se elige se muestra en la pantalla `/overlay/pantalla/<n>`.
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
  const { files, web, port, error, clearError } = useMediaLibrary(client);
  const [tab, setTab] = useState<Tab>(value.source === "web" ? "web" : "local");
  const [localError, setLocalError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [webUrl, setWebUrl] = useState("");
  const [webName, setWebName] = useState("");
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const before = useRef<Set<string> | null>(null);

  // El archivo que aparece de más tras subir es el nuevo: se elige solo.
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

  function addWeb() {
    if (!client) return;
    setLocalError(null);
    const u = parseMediaUrl(webUrl);
    if (!u) {
      setLocalError("Pega una URL válida (https://…) de una imagen, GIF o video.");
      return;
    }
    client.send("media", { kind: "add-web", url: u.href, name: webName.trim() });
    onChange({ ...value, source: "web", url: u.href, file: "" });
    setWebUrl("");
    setWebName("");
  }

  const chosen = value.source === "web" ? value.url : value.file;
  const missing = value.source === "local" && value.file !== "" && !files.some((f) => f.name === value.file) && files.length > 0;
  const overlayUrl = screenOverlayUrl(port, value.screen);
  const shownError = localError ?? error;
  const isVideo = mediaKindOf(value.source === "web" ? value.url.split("?")[0] : value.file) === "video";

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5" }}>
        <span style={{ minWidth: 130 }}>Duración (segundos):</span>
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
      <Slider
        label={`Volumen: ${value.volume}`}
        min={0}
        max={100}
        value={value.volume}
        onChange={(v) => onChange({ ...value, volume: v })}
        dim={!isVideo}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5", flexWrap: "wrap" }}>
        <span style={{ minWidth: 130 }}>Pantalla (overlay):</span>
        <select
          value={value.screen}
          onChange={(e) => onChange({ ...value, screen: Number(e.target.value) })}
          style={{ ...inputStyle, width: 80 }}
        >
          {Array.from({ length: MEDIA_MAX_SCREENS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input readOnly value={overlayUrl} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
        <button
          type="button"
          style={smallButtonStyle}
          onClick={() => {
            void navigator.clipboard?.writeText(overlayUrl).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
        >
          {copied ? "¡Copiada!" : "Copiar"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: "#5B5D66", lineHeight: 1.4, marginTop: -6 }}>
        Pega esta dirección como fuente web en TikTok LIVE Studio (una vez) y ahí aparecerá lo que dispare la acción.
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {(
          [
            ["local", "Archivos locales"],
            ["web", "Archivos web"],
            ["app", "Imágenes App"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              ...smallButtonStyle,
              height: 32,
              borderColor: tab === id ? ACCENT : "#2A2C33",
              background: tab === id ? "#E23A5718" : "#17181D",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "local" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={buttonStyle}
              title="JPG, PNG, WEBP, AVIF, GIF, MP4, WEBM o MOV (hasta 50 MB): se copia a la carpeta de medios y queda elegido"
              onClick={() => fileInput.current?.click()}
            >
              Subir archivo
            </button>
            <button type="button" style={buttonStyle} onClick={() => client?.send("media", { kind: "open-folder" })}>
              Abrir carpeta
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.mp4,.webm,.mov,image/*,video/mp4,video/webm,video/quicktime"
              multiple
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
              Suéltalo aquí (imagen, GIF o video)
            </div>
          </div>
          <List empty="Aún no hay archivos. Sube uno con el botón o suéltalo arriba.">
            {files.map((f) => (
              <Row
                key={f.name}
                selected={value.source === "local" && value.file === f.name}
                title={f.name}
                subtitle={`${f.kind === "video" ? "Video" : "Imagen"} · ${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                thumb={f.kind === "image" ? mediaFileUrl(port, f.name) : undefined}
                onPick={() => onChange({ ...value, source: "local", file: f.name, url: "" })}
                onDelete={() => client?.send("media", { kind: "delete", name: f.name })}
              />
            ))}
          </List>
        </>
      )}

      {tab === "web" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="URL de la imagen, GIF o video (https://…)"
              style={{ ...inputStyle, flex: 2, minWidth: 200 }}
            />
            <input
              value={webName}
              onChange={(e) => setWebName(e.target.value)}
              placeholder="Nombre"
              style={{ ...inputStyle, flex: 1, minWidth: 110 }}
            />
            <button type="button" style={{ ...buttonStyle, width: 40, padding: 0 }} onClick={addWeb} title="Guardar este enlace en la lista">
              +
            </button>
          </div>
          <List empty="Aún no hay enlaces guardados. Pega una URL y pulsa «+».">
            {web.map((w) => (
              <Row
                key={w.url}
                selected={value.source === "web" && value.url === w.url}
                title={w.name}
                subtitle={w.url}
                thumb={mediaKindOf(w.url.split("?")[0]) === "video" ? undefined : w.url}
                onPick={() => onChange({ ...value, source: "web", url: w.url, file: "" })}
                onDelete={() => client?.send("media", { kind: "delete-web", url: w.url })}
              />
            ))}
          </List>
        </>
      )}

      {tab === "app" && (
        <div style={{ fontSize: 11.5, color: "#9A9CA5", lineHeight: 1.5, padding: "6px 2px" }}>
          <b style={{ color: "#C4C5CC" }}>Próximamente.</b> Aquí irán las imágenes propias de cada juego de la app (por ejemplo, las de un mod).
          Mientras tanto, sube la imagen en «Archivos locales».
        </div>
      )}

      {shownError && <div style={{ fontSize: 11.5, color: "#F2776F" }}>{shownError}</div>}
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
      <span style={{ minWidth: 130 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: ACCENT }}
      />
    </div>
  );
}

function List({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
      {children.length === 0 ? <div style={{ fontSize: 11.5, color: "#5B5D66", padding: "6px 2px" }}>{empty}</div> : children}
    </div>
  );
}

function Row({
  selected,
  title,
  subtitle,
  thumb,
  onPick,
  onDelete,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  thumb?: string;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        border: `1px solid ${selected ? ACCENT : "#2A2C33"}`,
        background: selected ? "#E23A5718" : "transparent",
        borderRadius: 9,
      }}
    >
      <div
        style={{
          width: 44,
          height: 32,
          borderRadius: 6,
          background: "#17181D",
          flexShrink: 0,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
        }}
      >
        {thumb ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🎬"}
      </div>
      <button
        type="button"
        onClick={onPick}
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", color: "#F4F4F5", cursor: "pointer", padding: 0 }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 10.5, color: "#9A9CA5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>
      </button>
      <button type="button" onClick={onDelete} title="Quitar de la lista" style={{ ...smallButtonStyle, color: "#F2776F" }}>
        ✕
      </button>
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
