import { useEffect, useMemo, useRef, useState } from "react";
import { MEDIA_MAX_SCREENS, mediaKindOf, parseMediaUrl, type MediaFile, type MediaShowParams, type MediaWebItem } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { mediaFileUrl, screenOverlayUrl, uploadMediaFile, useMediaLibrary } from "../lib/use-media";

const ACCENT = "#E23A57";

type TabKey = "local" | "web" | "app";
const TAB_LABELS: Record<TabKey, string> = { local: "Archivos locales", web: "Archivos web", app: "Imágenes App" };

/** Miniatura: imagen o primer cuadro del video. */
function Thumb({ url, video }: { url: string; video: boolean }) {
  const style: React.CSSProperties = { width: "100%", height: 84, objectFit: "cover", borderRadius: 8, background: "#17181D", display: "block" };
  return video ? <video src={`${url}#t=0.1`} preload="metadata" muted style={style} /> : <img src={url} alt="" style={style} />;
}

function Card({
  title,
  subtitle,
  url,
  video,
  selected,
  onPick,
  onDelete,
}: {
  title: string;
  subtitle: string;
  url: string;
  video: boolean;
  selected: boolean;
  onPick: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      style={{
        background: selected ? "#E23A5718" : "#0E0F12",
        border: `1px solid ${selected ? ACCENT : "#2A2C33"}`,
        borderRadius: 12,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <Thumb url={url} video={video} />
      <span title={title} style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>
      <span style={{ fontSize: 11, color: "#9A9CA5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          title="Elegir este medio"
          onClick={onPick}
          style={{ ...iconButtonStyle, background: selected ? ACCENT : "#1E2027", color: "#fff" }}
        >
          ✓
        </button>
        {confirm ? (
          <button
            type="button"
            onClick={onDelete}
            onBlur={() => setConfirm(false)}
            autoFocus
            style={{ ...iconButtonStyle, background: "#B3261E", color: "#fff", flex: 2, fontSize: 11 }}
          >
            ¿Borrar?
          </button>
        ) : (
          <button type="button" title="Quitar de la lista" onClick={() => setConfirm(true)} style={{ ...iconButtonStyle, color: "#F2776F" }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * «Lista de medios» (ADR 0022), igual que la lista de audios: buscador, pestañas
 * Archivos locales / Archivos web / Imágenes App, subir archivo y «Abrir carpeta».
 * La pestaña web también da la dirección de la pantalla para pegar en TikTok LIVE Studio.
 */
export function MediaLibraryModal({
  client,
  value,
  onChange,
  onClose,
}: {
  client: SidecarClient | null;
  value: MediaShowParams;
  onChange: (next: MediaShowParams) => void;
  onClose: () => void;
}) {
  const { files, web, dir, port, error, clearError } = useMediaLibrary(client);
  const [tab, setTab] = useState<TabKey>(value.source === "web" ? "web" : "local");
  const [query, setQuery] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webName, setWebName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Archivos que había al subir: el que aparezca de más es el nuevo y queda elegido.
  const before = useRef<Set<string> | null>(null);

  const q = query.trim().toLowerCase();
  const shownFiles = useMemo(() => files.filter((f) => !q || f.name.toLowerCase().includes(q)), [files, q]);
  const shownWeb = useMemo(() => web.filter((w) => !q || `${w.name} ${w.url}`.toLowerCase().includes(q)), [web, q]);

  // Al llegar la lista nueva tras subir, elige el archivo recién agregado.
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

  const overlayUrl = screenOverlayUrl(port, value.screen);
  const shownError = localError ?? error;
  const count = { local: files.length, web: web.length, app: 0 };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: "'Space Grotesk', sans-serif" }}>Lista de medios</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "#9A9CA5", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar archivo…"
          autoFocus
          style={{ ...inputStyle, minWidth: 180 }}
        />

        <div style={{ display: "flex", gap: 6, background: "#0E0F12", border: "1px solid #2A2C33", borderRadius: 10, padding: 4 }}>
          {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              title={
                k === "local" ? "Imágenes, GIF y videos que subiste desde tu PC" : k === "web" ? "Enlaces de internet y la dirección de la pantalla" : "Imágenes propias de los juegos de la app"
              }
              style={{ ...tabStyle, border: "none", cursor: "pointer", background: tab === k ? ACCENT : "transparent", color: tab === k ? "#fff" : "#9A9CA5" }}
            >
              {TAB_LABELS[k]} ({count[k]})
            </button>
          ))}
        </div>

        {tab === "web" && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 11.5, color: "#9A9CA5", display: "flex", alignItems: "center", gap: 8 }}>
                Pantalla:
                <select
                  value={value.screen}
                  onChange={(e) => onChange({ ...value, screen: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 70 }}
                >
                  {Array.from({ length: MEDIA_MAX_SCREENS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <input readOnly value={overlayUrl} onFocus={(e) => e.currentTarget.select()} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
              <button
                type="button"
                style={secondaryButtonStyle}
                title="Cópiala y pégala como fuente web en TikTok LIVE Studio"
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
                {copied ? "¡Copiada!" : "Copiar URL"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              <input
                value={webUrl}
                onChange={(e) => setWebUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWeb()}
                placeholder="URL de la imagen, GIF o video (https://…)"
                style={{ ...inputStyle, flex: 2, minWidth: 0 }}
              />
              <input
                value={webName}
                onChange={(e) => setWebName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWeb()}
                placeholder="Nombre de la URL"
                style={{ ...inputStyle, flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={addWeb}
                disabled={!webUrl.trim()}
                style={{ ...secondaryButtonStyle, width: 44, padding: 0, opacity: webUrl.trim() ? 1 : 0.5 }}
                title="Guardar este enlace en la lista"
              >
                +
              </button>
            </div>
          </>
        )}

        {tab === "local" && (
          <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
            <button type="button" title="Abre la carpeta donde se guardan los medios, para copiar o borrar archivos a mano" onClick={() => client?.send("media", { kind: "open-folder" })} style={secondaryButtonStyle}>
              Abrir carpeta
            </button>
            <button
              type="button"
              title="JPG, PNG, WEBP, AVIF, GIF, MP4, WEBM o MOV (hasta 50 MB): se copia a la carpeta y queda elegido"
              onClick={() => fileInput.current?.click()}
              style={secondaryButtonStyle}
            >
              Subir archivo
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
                minWidth: 180,
                border: `1px dashed ${drag ? ACCENT : "#2A2C33"}`,
                borderRadius: 9,
                padding: "8px 12px",
                fontSize: 11.5,
                color: drag ? "#fff" : "#9A9CA5",
                display: "flex",
                alignItems: "center",
              }}
            >
              o suéltalo aquí (imagen, GIF o video, máx. 50 MB)
            </div>
          </div>
        )}

        {tab !== "app" && (
          <div style={{ fontSize: 11, color: "#9A9CA5", borderLeft: "3px solid #5BC0A0", background: "#0E0F12", padding: "8px 12px", borderRadius: 6, lineHeight: 1.5 }}>
            {tab === "local" ? (
              <>
                Se guardan en <b style={{ color: "#C4C5CC" }}>{dir || "la carpeta de StreamTok"}</b>. Haz una copia antes de formatear o cambiar de equipo: no se pasan solos al otro.
              </>
            ) : (
              <>Los enlaces se cargan desde internet cada vez que se muestran: si la página los borra, dejarán de verse.</>
            )}
          </div>
        )}

        {shownError && (
          <div style={{ fontSize: 12, color: "#F2776F", display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>{shownError}</span>
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                clearError();
              }}
              style={{ background: "none", border: "none", color: "#9A9CA5", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        )}

        {tab === "app" ? (
          <div style={emptyStyle}>
            <b style={{ color: "#C4C5CC" }}>Próximamente.</b> Aquí irán las imágenes propias de cada juego de la app (por ejemplo, las de un mod). Mientras tanto, sube la imagen en «Archivos locales».
          </div>
        ) : (tab === "local" ? shownFiles.length : shownWeb.length) === 0 ? (
          <div style={emptyStyle}>
            {count[tab] > 0
              ? "Nada coincide con la búsqueda."
              : tab === "local"
                ? "Aún no hay archivos. Sube una imagen, GIF o video, o copia tus archivos a la carpeta."
                : "Aún no hay enlaces. Pega una URL arriba, ponle un nombre y pulsa «+»."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {tab === "local"
              ? shownFiles.map((f: MediaFile) => (
                  <Card
                    key={f.name}
                    title={f.name.replace(/\.[^.]+$/, "")}
                    subtitle={`${f.kind === "video" ? "Video" : "Imagen"} · ${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                    url={mediaFileUrl(port, f.name)}
                    video={f.kind === "video"}
                    selected={value.source === "local" && value.file === f.name}
                    onPick={() => {
                      onChange({ ...value, source: "local", file: f.name, url: "" });
                      onClose();
                    }}
                    onDelete={() => client?.send("media", { kind: "delete", name: f.name })}
                  />
                ))
              : shownWeb.map((w: MediaWebItem) => (
                  <Card
                    key={w.url}
                    title={w.name}
                    subtitle={w.url}
                    url={w.url}
                    video={mediaKindOf(w.url.split("?")[0]) === "video"}
                    selected={value.source === "web" && value.url === w.url}
                    onPick={() => {
                      onChange({ ...value, source: "web", url: w.url, file: "" });
                      onClose();
                    }}
                    onDelete={() => client?.send("media", { kind: "delete-web", url: w.url })}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(14, 15, 18, 0.7)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  zIndex: 200,
  padding: 40,
  overflowY: "auto",
};

const cardStyle: React.CSSProperties = {
  width: 720,
  maxWidth: "100%",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 16,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 20px 60px #00000080",
  boxSizing: "border-box",
  color: "#F4F4F5",
};

const inputStyle: React.CSSProperties = {
  height: 38,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#F4F4F5",
  padding: "0 12px",
  fontSize: 12.5,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "'Manrope', sans-serif",
};

const tabStyle: React.CSSProperties = { flex: 1, textAlign: "center", padding: "8px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 700 };

const secondaryButtonStyle: React.CSSProperties = {
  height: 38,
  padding: "0 16px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#F4F4F5",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const iconButtonStyle: React.CSSProperties = {
  flex: 1,
  height: 30,
  background: "#1E2027",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  cursor: "pointer",
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = { padding: "24px 8px", textAlign: "center", fontSize: 12.5, color: "#9A9CA5", lineHeight: 1.6 };
