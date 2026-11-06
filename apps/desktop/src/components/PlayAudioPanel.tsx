import { useEffect, useRef, useState } from "react";
import type { AudioPlayParams } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { requestAudioPlay, uploadAudioFile, useAudioLibrary } from "../lib/use-audio";
import { AudioLibraryModal } from "./AudioLibraryModal";

const ACCENT = "#E23A57";

/** Opciones de reproducción, con el mismo texto que explica cada una. */
const MODES: Array<{ key: "oneShot" | "skip" | "queue"; title: string; hint: string }> = [
  { key: "oneShot", title: "Audio One-Shot", hint: "Si este audio ya está sonando, los nuevos disparos se ignoran hasta que acabe." },
  { key: "skip", title: "Saltar audio", hint: "Corta todos los audios que estén sonando antes de reproducir este." },
  { key: "queue", title: "Añadir a la cola", hint: "Espera a que terminen los audios que suenan en vez de sonar a la vez." },
];

/**
 * Panel de la acción general "Play Audio" (ADR 0019): elegir el audio (de la lista o
 * subiendo un archivo), volumen y cómo se comporta si ya hay audios sonando.
 */
export function PlayAudioPanel({
  client,
  value,
  onChange,
}: {
  client: SidecarClient | null;
  value: AudioPlayParams;
  onChange: (next: AudioPlayParams) => void;
}) {
  const { files, error, clearError } = useAudioLibrary(client);
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
      onChange({ ...value, file: added[added.length - 1].name });
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
      const err = await uploadAudioFile(client, f);
      if (err) {
        setLocalError(err);
        before.current = null;
      }
    }
  }

  const missing = value.file !== "" && !files.some((f) => f.name === value.file) && files.length > 0;
  const shownError = localError ?? error;

  return (
    <div
      style={{
        margin: "4px 14px 12px 40px",
        padding: 14,
        background: "#0E0F12",
        border: "1px solid #2A2C33",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "#9A9CA5" }}>Audio:</span>
        <span
          title={value.file}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 700,
            color: value.file ? (missing ? "#F2776F" : "#F4F4F5") : "#5B5D66",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value.file ? value.file : "Ninguno elegido"}
          {missing ? " (ya no está en la carpeta)" : ""}
        </span>
        <button
          type="button"
          disabled={!client || !value.file || missing}
          onClick={() => client && requestAudioPlay(client, value)}
          style={{ ...smallButtonStyle, opacity: !value.file || missing ? 0.4 : 1 }}
          title="Lo reproduce igual que cuando lo dispare un evento"
        >
          ▶ Probar
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "#9A9CA5" }}>
        <span style={{ minWidth: 86 }}>Volumen: {value.volume}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value.volume}
          onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
          style={{ flex: 1, accentColor: ACCENT }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <button type="button" onClick={() => setListOpen(true)} style={buttonStyle}>
          Abrir lista de audios
        </button>
        <button
          type="button"
          title="Elige un MP3, WAV u OGG de tu PC: se copia a la carpeta de audios y queda elegido"
          onClick={() => fileInput.current?.click()}
          style={buttonStyle}
        >
          Subir archivo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
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
          o suelta aquí el archivo desde tu PC (MP3, WAV u OGG)
        </div>
      </div>

      {shownError && <div style={{ fontSize: 11.5, color: "#F2776F" }}>{shownError}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {MODES.map((m) => {
          const on = value[m.key];
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                // "Saltar" corta todo, así que no tiene sentido combinarlo con "cola".
                const next = { ...value, [m.key]: !on };
                if (!on && m.key === "skip") next.queue = false;
                if (!on && m.key === "queue") next.skip = false;
                onChange(next);
              }}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                textAlign: "left",
                padding: "8px 10px",
                background: on ? "#E23A5718" : "transparent",
                border: `1px solid ${on ? ACCENT : "#2A2C33"}`,
                borderRadius: 9,
                color: "#F4F4F5",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 15,
                  height: 15,
                  marginTop: 1,
                  borderRadius: 4,
                  flexShrink: 0,
                  border: `1px solid ${on ? ACCENT : "#5B5D66"}`,
                  background: on ? ACCENT : "transparent",
                  color: "#fff",
                  fontSize: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {on ? "✓" : ""}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{m.title}</span>
                <span style={{ fontSize: 11, color: "#9A9CA5", lineHeight: 1.4 }}>{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {listOpen && (
        <AudioLibraryModal
          client={client}
          selected={value.file}
          onPick={(file) => onChange({ ...value, file })}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  );
}

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
