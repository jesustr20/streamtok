import { useEffect, useState } from "react";
import {
  AUDIO_COMMAND_ID,
  MEDIA_COMMAND_ID,
  type Accion,
  type AccionesMessage,
  type Evento,
  type EventosMessage,
  type ModHelloPayload,
} from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { describeQuien } from "../lib/labels";
import { matchesQuery } from "../lib/search";
import { useEmoteCatalog } from "../lib/use-emote-catalog";
import { optionFor } from "./EmotePicker";
import { AccionModal } from "./AccionModal";
import { EventoModal } from "./EventoModal";
import { Pagination, usePagination } from "./Pagination";

const ACCENT = "#E23A57";

/** Desencadenantes que viven en este panel (los dos antiguos siguen valiendo y se editan como el nuevo). */
export const STICKER_PORQUES = new Set<string>(["stickerEmote", "emoteSuscriptor", "stickerFanClub"]);

function sanitizeUnknownParams(params: Record<string, unknown>): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Texto de la columna Descripción: qué hace la alerta (p. ej. «Audio: gato riendo.mp3»). */
export function describeAccion(a: Accion): string {
  const parts: string[] = [];
  for (const c of a.comandos) {
    if (c.modActionId === AUDIO_COMMAND_ID) {
      const file = typeof c.params.file === "string" ? c.params.file : "";
      parts.push(`Audio: ${file.replace(/\.(mp3|wav|ogg)$/i, "")}`);
    } else if (c.modActionId === MEDIA_COMMAND_ID) {
      const label = c.params.source === "web" ? c.params.url : c.params.file;
      parts.push(`Medio: ${typeof label === "string" ? label : ""}`);
    } else {
      parts.push(c.modActionId);
    }
  }
  const text = parts.join(" · ");
  return text || a.descripcion || "—";
}

/**
 * Panel «Stickers y emotes» (ADR 0021): reúne en un solo lugar las alertas que se disparan
 * con un sticker o emote (Club de fans / Super Fan), como la pantalla «Alertas» de Interactive.
 * No guarda nada propio: son los mismos Eventos y Acciones del perfil activo, filtrados por el
 * desencadenante «sticker o emote», y se editan con los mismos modales.
 */
export function StickersView({ client, catalog }: { client: SidecarClient | null; catalog: ModHelloPayload | null }) {
  const [acciones, setAcciones] = useState<Accion[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const emotes = useEmoteCatalog(client);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [accionModal, setAccionModal] = useState<{ initial: Accion | null } | null>(null);
  const [eventoModal, setEventoModal] = useState<{ initial: Evento | null } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel === "acciones") {
        const msg = evt.payload as AccionesMessage;
        if (msg.kind === "update") setAcciones(msg.acciones);
        else if (msg.kind === "error") setError(msg.message);
      } else if (evt.channel === "eventos") {
        const msg = evt.payload as EventosMessage;
        if (msg.kind === "update") setEventos(msg.eventos);
        else if (msg.kind === "error") setError(msg.message);
      }
    });
    // Acciones y eventos llegan con el estado de `profiles` (no tienen get-state propio).
    client.send("profiles", { kind: "get-state" });
    return off;
  }, [client]);

  const accionById = (id: string) => acciones.find((a) => a.id === id);
  const accionesDe = (e: Evento) => [...e.accionesTodas, ...e.accionesAleatorias].map(accionById);

  const rows = eventos
    .filter((e) => STICKER_PORQUES.has(e.porque))
    .map((e) => {
      const linked = accionesDe(e);
      const opt = optionFor(
        e.porque === "emoteSuscriptor"
          ? { id: e.emoteId, scene: "subscriber" }
          : e.porque === "stickerFanClub"
            ? { id: e.stickerId, scene: "fanClub" }
            : { id: e.emoteId, scene: e.emoteScene },
        emotes,
      );
      const names = linked.map((a, i) => a?.nombre ?? `(${[...e.accionesTodas, ...e.accionesAleatorias][i].slice(0, 6)}… borrada)`);
      const duration = Math.max(0, ...linked.map((a) => a?.duracionSeg ?? 0));
      const description = linked.map((a) => (a ? describeAccion(a) : "—")).join(" · ");
      return { evento: e, option: opt, names, duration, description, linked };
    });

  const filtered = rows.filter((r) =>
    matchesQuery(`${r.names.join(" ")} ${r.option.title} ${r.option.subtitle ?? ""} ${r.description} ${describeQuien(r.evento)}`, search),
  );
  const paging = usePagination(filtered, search);

  function saveAccion(accion: Accion) {
    const next = acciones.some((a) => a.id === accion.id)
      ? acciones.map((a) => (a.id === accion.id ? accion : a))
      : [...acciones, accion];
    client?.send("acciones", { kind: "set", acciones: next });
    setAccionModal(null);
    setError(null);
  }

  function saveEvento(evento: Evento) {
    const next = eventos.some((e) => e.id === evento.id)
      ? eventos.map((e) => (e.id === evento.id ? evento : e))
      : [...eventos, evento];
    client?.send("eventos", { kind: "set", eventos: next });
    setEventoModal(null);
    setError(null);
  }

  function deleteEvento(id: string) {
    client?.send("eventos", { kind: "set", eventos: eventos.filter((e) => e.id !== id) });
  }

  function toggleActivo(id: string) {
    client?.send("eventos", { kind: "set", eventos: eventos.map((e) => (e.id === id ? { ...e, activo: !e.activo } : e)) });
  }

  /** ▶: ejecuta las acciones de la alerta como lo haría el evento (audio incluido). */
  async function testRow(linked: (Accion | undefined)[], eventId: string) {
    if (!client) return;
    setTestingId(eventId);
    for (const a of linked) {
      if (!a) continue;
      for (const c of a.comandos) {
        try {
          await client.sendManualCommand({ action: c.modActionId, params: sanitizeUnknownParams(c.params) });
        } catch {
          // el resultado real se oye/ve en el juego o en el audio; no se muestra aquí
        }
      }
    }
    setTestingId(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "28px 32px", maxWidth: 1180 }}>
      <div>
        <span style={eyebrowStyle}>INTERACTIVIDAD</span>
        <h1 style={titleStyle}>Stickers y emotes</h1>
        <p style={descStyle}>
          Aquí ves y creas lo que pasa cuando un viewer envía un sticker del Club de fans o un emote de Super Fan:
          un audio, una alerta o un comando de un juego. Cada alerta junta un <b>evento</b> (el sticker) con sus{" "}
          <b>acciones</b>, y usa los mismos editores de Acciones y Eventos de siempre. La lista de stickers se llena sola con los que van llegando a tu LIVE.
        </p>
      </div>

      {error && (
        <div role="alert" style={{ padding: "10px 12px", background: "#2A1416", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12.5 }}>
          <strong>No se guardó: </strong>
          {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setAccionModal({ initial: null })} style={createButtonStyle} title="Qué pasa: audio, alerta, comando de un juego…">
            + Crear nueva Acción
          </button>
          <button type="button" onClick={() => setEventoModal({ initial: null })} style={createButtonStyle} title="Qué sticker o emote lo dispara y qué acciones ejecuta">
            + Crear nuevo Evento
          </button>
        </div>
        <div style={searchBoxStyle}>
          <span style={{ color: "#5B5D66", fontSize: 12, marginRight: 6 }}>⌕</span>
          <input style={searchInputStyle} value={search} placeholder="Buscar alertas…" onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div style={tableContainerStyle}>
        <table style={{ ...tableStyle, minWidth: 900 }}>
          <colgroup>
            <col style={{ width: "10%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "27%" }} />
          </colgroup>
          <thead>
            <tr style={headerRowStyle}>
              <th style={thStyle} />
              <th style={{ ...thStyle, textAlign: "center" }}>Activo</th>
              <th style={thStyle}>Acciones</th>
              <th style={thStyle}>Evento</th>
              <th style={thStyle}>Duración (seg)</th>
              <th style={thStyle}>Descripción</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={emptyStyle}>
                  {rows.length === 0
                    ? "Aún no hay alertas de stickers. Crea una acción (por ejemplo, Play Audio) y luego un evento «Enviando un sticker o emote»."
                    : "Ninguna alerta coincide con la búsqueda."}
                </td>
              </tr>
            ) : (
              paging.pageItems.map((r) => (
                <tr key={r.evento.id}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        title="Probar (ejecuta las acciones como si llegara el sticker)"
                        disabled={testingId !== null || r.linked.length === 0}
                        onClick={() => testRow(r.linked, r.evento.id)}
                        style={iconButtonStyle}
                      >
                        ▶
                      </button>
                      <button type="button" title="Editar el evento" onClick={() => setEventoModal({ initial: r.evento })} style={iconButtonStyle}>
                        ✎
                      </button>
                      <button type="button" title="Borrar la alerta (la acción se conserva)" onClick={() => deleteEvento(r.evento.id)} style={{ ...iconButtonStyle, color: "#E5484D" }}>
                        🗑
                      </button>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <button
                      type="button"
                      title={r.evento.activo ? "Desactivar" : "Activar"}
                      onClick={() => toggleActivo(r.evento.id)}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: `1px solid ${r.evento.activo ? ACCENT : "#3A3C44"}`,
                        background: r.evento.activo ? ACCENT : "transparent",
                        color: "#fff",
                        fontSize: 10,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {r.evento.activo ? "✓" : ""}
                    </button>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: 600, whiteSpace: "normal" }}>
                    {r.linked.length === 0 ? (
                      <span style={{ color: "#5B5D66" }}>—</span>
                    ) : (
                      r.names.map((n, i) => {
                        const a = r.linked[i];
                        return (
                          <div key={i}>
                            {a ? (
                              <button type="button" title="Editar esta acción" onClick={() => setAccionModal({ initial: a })} style={linkButtonStyle}>
                                {n}
                              </button>
                            ) : (
                              n
                            )}
                          </div>
                        );
                      })
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {r.option.imageUrl ? (
                        <img src={r.option.imageUrl} alt="" referrerPolicy="no-referrer" style={{ width: 30, height: 30, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 30, height: 30, borderRadius: 6, border: "1px dashed #3A3C44", display: "flex", alignItems: "center", justifyContent: "center", color: "#5B5D66", flexShrink: 0 }}>*</span>
                      )}
                      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F4F5", whiteSpace: "normal" }}>{r.option.title}</span>
                        <span style={{ fontSize: 11, color: "#9A9CA5", whiteSpace: "normal" }}>
                          {r.option.subtitle}
                          {r.evento.quien !== "todos" ? ` · ${describeQuien(r.evento)}` : ""}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "#C4C5CC" }}>{r.duration}</td>
                  <td style={{ ...tdStyle, color: "#9A9CA5", whiteSpace: "normal", fontSize: 11.5 }}>{r.description || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={paging.page} pageCount={paging.pageCount} onChange={paging.setPage} />

      {accionModal && (
        <AccionModal catalog={catalog} client={client} initial={accionModal.initial} onSave={saveAccion} onClose={() => setAccionModal(null)} />
      )}
      {eventoModal && (
        <EventoModal
          acciones={acciones}
          initial={eventoModal.initial}
          onSave={saveEvento}
          onClose={() => setEventoModal(null)}
          client={client}
          soloStickers
        />
      )}
    </div>
  );
}

const eyebrowStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#5B7CFA", letterSpacing: "0.06em" };
const titleStyle: React.CSSProperties = { margin: "4px 0 0", fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700 };
const descStyle: React.CSSProperties = { margin: "8px 0 0", fontSize: 12.5, color: "#9A9CA5", lineHeight: 1.6, maxWidth: 760 };
const createButtonStyle: React.CSSProperties = {
  padding: "0 14px",
  height: 34,
  background: ACCENT,
  color: "#FFFFFF",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
  cursor: "pointer",
  border: "none",
};
const searchBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  padding: "0 12px",
  height: 32,
  width: 220,
  boxSizing: "border-box",
};
const searchInputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  color: "#F4F4F5",
  fontSize: 11.5,
  padding: 0,
  minWidth: 0,
  outline: "none",
  fontFamily: "'Manrope', sans-serif",
};
const tableContainerStyle: React.CSSProperties = { border: "1px solid #2A2C33", borderRadius: 10, overflow: "hidden", overflowX: "auto", background: "#17181D" };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
const headerRowStyle: React.CSSProperties = { background: "#0E0F12" };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10,
  fontWeight: 700,
  color: "#6B6D76",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  padding: "9px 12px",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};
const tdStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "10px 12px",
  borderTop: "1px solid #22242B",
  overflow: "hidden",
  boxSizing: "border-box",
  verticalAlign: "middle",
};
const emptyStyle: React.CSSProperties = { padding: 22, color: "#5B5D66", fontSize: 12.5, textAlign: "center" };
const iconButtonStyle: React.CSSProperties = { background: "none", border: "none", color: "#5B7CFA", fontSize: 12, cursor: "pointer", padding: "0 2px" };
const linkButtonStyle: React.CSSProperties = { background: "none", border: "none", color: "#F4F4F5", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
