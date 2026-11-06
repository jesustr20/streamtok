import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioFile } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { audioFileUrl, uploadAudioFile, useAudioLibrary } from "../lib/use-audio";

const ACCENT = "#E23A57";

type SortKey = "name-asc" | "name-desc" | "size-asc" | "size-desc";

const SORT_LABELS: Record<SortKey, string> = {
  "name-asc": "Nombre (A → Z)",
  "name-desc": "Nombre (Z → A)",
  "size-asc": "Tamaño (menor a mayor)",
  "size-desc": "Tamaño (mayor a menor)",
};

/** Duración del audio leyendo solo su metadata (se carga una vez por tarjeta visible). */
function useDuration(url: string): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => setSeconds(Number.isFinite(a.duration) ? a.duration : null);
    a.src = url;
    return () => {
      a.onloadedmetadata = null;
      a.src = "";
    };
  }, [url]);
  return seconds;
}

function AudioCard({
  file,
  port,
  volume,
  selected,
  playing,
  onPlay,
  onPick,
  onDelete,
}: {
  file: AudioFile;
  port: number;
  volume: number;
  selected: boolean;
  playing: boolean;
  onPlay: () => void;
  onPick: () => void;
  onDelete: () => void;
}) {
  const duration = useDuration(audioFileUrl(port, file.name));
  const [confirmDelete, setConfirmDelete] = useState(false);
  void volume;
  return (
    <div
      style={{
        background: selected ? "#E23A5718" : "#0E0F12",
        border: `1px solid ${selected ? ACCENT : "#2A2C33"}`,
        borderRadius: 12,
        padding: "10px 10px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <span
        title={file.name}
        style={{ fontSize: 12.5, fontWeight: 700, color: "#F4F4F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {file.name.replace(/\.[^.]+$/, "")}
      </span>
      <span style={{ fontSize: 11, color: "#9A9CA5" }}>
        {duration === null ? "…" : `${duration.toFixed(1)} seg`} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" title={playing ? "Detener" : "Escuchar"} onClick={onPlay} style={iconButtonStyle}>
          {playing ? "■" : "▶"}
        </button>
        <button
          type="button"
          title="Elegir este audio"
          onClick={onPick}
          style={{ ...iconButtonStyle, background: selected ? ACCENT : "#1E2027", color: "#fff" }}
        >
          ✓
        </button>
        {confirmDelete ? (
          <button
            type="button"
            title="Confirmar borrado"
            onClick={onDelete}
            onBlur={() => setConfirmDelete(false)}
            autoFocus
            style={{ ...iconButtonStyle, background: "#B3261E", color: "#fff", flex: 2, fontSize: 11 }}
          >
            ¿Borrar?
          </button>
        ) : (
          <button
            type="button"
            title="Borrar de la carpeta"
            onClick={() => setConfirmDelete(true)}
            style={{ ...iconButtonStyle, color: "#F2776F" }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "Lista de audios" (ADR 0019): los audios de la carpeta del streamer, con buscador,
 * ▶ para escuchar, ✓ para elegir, subir archivo y "Abrir Carpeta". Las pestañas de
 * audios públicos y de MyInstants llegan en una siguiente parte.
 */
export function AudioLibraryModal({
  client,
  selected,
  onPick,
  onClose,
}: {
  client: SidecarClient | null;
  selected: string;
  onPick: (file: string) => void;
  onClose: () => void;
}) {
  const { files, dir, port, error, clearError } = useAudioLibrary(client);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [volume, setVolume] = useState(50);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = files.filter((f) => !q || f.name.toLowerCase().includes(q));
    const by = {
      "name-asc": (a: AudioFile, b: AudioFile) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
      "name-desc": (a: AudioFile, b: AudioFile) => b.name.localeCompare(a.name, "es", { sensitivity: "base" }),
      "size-asc": (a: AudioFile, b: AudioFile) => a.sizeBytes - b.sizeBytes,
      "size-desc": (a: AudioFile, b: AudioFile) => b.sizeBytes - a.sizeBytes,
    }[sort];
    return [...list].sort(by);
  }, [files, query, sort]);

  function togglePlay(name: string) {
    audioRef.current?.pause();
    if (playingFile === name) {
      setPlayingFile(null);
      return;
    }
    const a = new Audio(audioFileUrl(port, name));
    a.volume = volume / 100;
    a.onended = () => setPlayingFile((cur) => (cur === name ? null : cur));
    a.onerror = () => setPlayingFile((cur) => (cur === name ? null : cur));
    audioRef.current = a;
    setPlayingFile(name);
    a.play().catch(() => setPlayingFile(null));
  }

  async function upload(list: FileList | File[]) {
    if (!client) return;
    setLocalError(null);
    for (const f of Array.from(list)) {
      const err = await uploadAudioFile(client, f);
      if (err) setLocalError(err);
    }
  }

  const shownError = localError ?? error;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: "'Space Grotesk', sans-serif" }}>Lista de audios</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "#9A9CA5", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar audios…"
            autoFocus
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
          <label style={{ fontSize: 11.5, color: "#9A9CA5", display: "flex", alignItems: "center", gap: 8 }}>
            Ordenar por:
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ ...inputStyle, width: 190 }}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5" }}>
          <span>Volumen de prueba: {volume}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (audioRef.current) audioRef.current.volume = v / 100;
            }}
            style={{ flex: 1, accentColor: ACCENT }}
          />
        </div>

        <div style={{ display: "flex", gap: 6, background: "#0E0F12", border: "1px solid #2A2C33", borderRadius: 10, padding: 4 }}>
          <span style={{ ...tabStyle, color: "#5B5D66" }} title="Próximamente">
            Audios públicos
          </span>
          <span style={{ ...tabStyle, background: ACCENT, color: "#fff" }}>Audios locales ({files.length})</span>
          <span style={{ ...tabStyle, color: "#5B5D66" }} title="Próximamente">
            MyInstants
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
          <button
            type="button"
            title="Abre la carpeta donde se guardan los audios, para copiar o borrar archivos a mano"
            onClick={() => client?.send("audio", { kind: "open-folder" })}
            style={secondaryButtonStyle}
          >
            Abrir carpeta
          </button>
          <button
            type="button"
            title="Elige un MP3, WAV u OGG de tu PC: se copia a la carpeta de audios y aparece en la lista"
            onClick={() => fileInput.current?.click()}
            style={secondaryButtonStyle}
          >
            Subir archivo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
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
            o suelta aquí tus MP3 (máx. 10 MB c/u)
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#9A9CA5", borderLeft: "3px solid #5BC0A0", background: "#0E0F12", padding: "8px 12px", borderRadius: 6, lineHeight: 1.5 }}>
          Se guardan en <b style={{ color: "#C4C5CC" }}>{dir || "la carpeta de StreamTok"}</b>. Haz una copia antes de formatear o cambiar de equipo: no se pasan solos al otro.
        </div>

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

        {shown.length === 0 ? (
          <div style={{ padding: "24px 8px", textAlign: "center", fontSize: 12.5, color: "#5B5D66", lineHeight: 1.6 }}>
            {files.length === 0
              ? "Aún no hay audios. Sube un MP3 o copia tus archivos a la carpeta."
              : "Ningún audio coincide con la búsqueda."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {shown.map((f) => (
              <AudioCard
                key={f.name}
                file={f}
                port={port}
                volume={volume}
                selected={f.name === selected}
                playing={playingFile === f.name}
                onPlay={() => togglePlay(f.name)}
                onPick={() => {
                  audioRef.current?.pause();
                  onPick(f.name);
                  onClose();
                }}
                onDelete={() => {
                  if (playingFile === f.name) audioRef.current?.pause();
                  client?.send("audio", { kind: "delete", name: f.name });
                }}
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

const tabStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "center",
  padding: "8px 10px",
  borderRadius: 7,
  fontSize: 12.5,
  fontWeight: 700,
};

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
