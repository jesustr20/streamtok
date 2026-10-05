import { useEffect, useState } from "react";
import type {
  Accion,
  AccionesMessage,
  Evento,
  EventosMessage,
  GiftCatalogEntry,
  GiftCatalogMessage,
  ModHelloPayload,
} from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { describeQuien, PORQUE_LABELS } from "../lib/labels";
import { AccionModal } from "./AccionModal";
import { EventoModal } from "./EventoModal";

function sanitizeUnknownParams(
  params: Record<string, unknown>,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function newId(): string {
  return crypto.randomUUID();
}

function accionNamesFor(acciones: Accion[], ids: string[]): string {
  return ids
    .map((id) => acciones.find((a) => a.id === id)?.nombre ?? `(${id.slice(0, 6)}… borrada)`)
    .join(", ");
}

/** Todas las acciones referenciadas por un Evento (fijas + aleatorias). */
function eventoAccionesIds(e: Evento): string[] {
  return [...e.accionesTodas, ...e.accionesAleatorias];
}

/**
 * Texto/estructura de la columna "Trigger": qué dato concreto dispara el evento
 * (el regalo con imagen/nombre/coins, el comando, el mínimo de likes, etc.).
 */
type TriggerInfo =
  | { kind: "gift"; name: string; cost?: number; imageUrl?: string; id?: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

function triggerFor(e: Evento, gifts: GiftCatalogEntry[]): TriggerInfo {
  switch (e.porque) {
    case "regaloEspecifico": {
      const g = gifts.find((x) => (e.giftId && x.id === e.giftId) || (e.giftName && x.name === e.giftName));
      return {
        kind: "gift",
        name: g?.name ?? e.giftName ?? `ID ${e.giftId}`,
        cost: g?.cost,
        imageUrl: g?.imageUrl,
        id: g?.id ?? e.giftId,
      };
    }
    case "regaloValorMinimo":
      return { kind: "text", text: `≥ ${e.valorMinimoMonedas ?? 1} coins` };
    case "comando":
      return e.comando ? { kind: "text", text: e.comando } : { kind: "none" };
    case "likes":
      return { kind: "text", text: `${e.cantidadMinimaLikes ?? 1} likes` };
    case "subeNivelFan":
    case "subeNivelDonador":
      return { kind: "text", text: `Nivel ≥ ${e.nivelMinimo ?? 1}` };
    case "emoteSuscriptor":
      return e.emoteId ? { kind: "text", text: `Emote ${e.emoteId}` } : { kind: "none" };
    case "stickerFanClub":
      return e.stickerId ? { kind: "text", text: `Sticker ${e.stickerId}` } : { kind: "none" };
    case "compraTiktokShop":
      return e.nombreProductoContiene
        ? { kind: "text", text: `Producto: ${e.nombreProductoContiene}` }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
}

function triggerSearchText(t: TriggerInfo): string {
  if (t.kind === "gift") return `${t.name} ${t.cost ?? ""} ${t.id ?? ""}`;
  if (t.kind === "text") return t.text;
  return "";
}

function TriggerCell({ trigger }: { trigger: TriggerInfo }) {
  if (trigger.kind === "none") return <span style={{ color: "#5B5D66" }}>—</span>;
  if (trigger.kind === "text") return <span style={{ color: "#C4C5CC" }}>{trigger.text}</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      {trigger.imageUrl && (
        <img
          src={trigger.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
        />
      )}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F4F5", whiteSpace: "normal" }}>
        {trigger.name}
        {trigger.cost !== undefined ? ` - ${trigger.cost} coin${trigger.cost === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}

function eventoSearchText(e: Evento, acciones: Accion[], gifts: GiftCatalogEntry[]): string {
  return [
    describeQuien(e),
    PORQUE_LABELS[e.porque],
    triggerSearchText(triggerFor(e, gifts)),
    e.usuarioEspecifico ?? "",
    e.comando ?? "",
    accionNamesFor(acciones, eventoAccionesIds(e)),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Sección "Acciones y Eventos" (issue #24): dos tablas independientes que
 * gestionan las Acciones y Eventos del perfil activo por los canales WS
 * `acciones`/`eventos` (patrón set/update, igual que `profiles`). Reemplaza el
 * wizard de regalos y el panel de reglas de comunidad retirados en PR #22.
 */
export function AccionesEventosSection({
  catalog,
  client,
}: {
  catalog: ModHelloPayload | null;
  client: SidecarClient | null;
}) {
  const [acciones, setAcciones] = useState<Accion[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [gifts, setGifts] = useState<GiftCatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [accionModal, setAccionModal] = useState<{ initial: Accion | null } | null>(null);
  const [eventoModal, setEventoModal] = useState<{ initial: Evento | null } | null>(null);

  const [accionSearch, setAccionSearch] = useState("");
  const [eventoSearch, setEventoSearch] = useState("");
  const [habilitado, setHabilitado] = useState(true);

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
      } else if (evt.channel === "gift-catalog") {
        const msg = evt.payload as GiftCatalogMessage;
        if (msg.kind === "state") setGifts(msg.gifts);
      }
    });
    // Snapshot bajo demanda: si esta sección se monta después de la conexión
    // inicial (el usuario venía de Inicio), pide el estado actual del perfil
    // activo: acciones y eventos no tienen `get-state` propio, llegan con el de
    // `profiles`.
    client.send("profiles", { kind: "get-state" });
    client.send("gift-catalog", { kind: "get-state" });
    return off;
  }, [client]);

  // --- CRUD acciones ---
  function saveAccion(accion: Accion) {
    const exists = acciones.some((a) => a.id === accion.id);
    const next = exists
      ? acciones.map((a) => (a.id === accion.id ? accion : a))
      : [...acciones, accion];
    client?.send("acciones", { kind: "set", acciones: next });
    setAccionModal(null);
    setError(null);
  }

  function deleteAccion(id: string) {
    client?.send("acciones", { kind: "set", acciones: acciones.filter((a) => a.id !== id) });
  }

  function duplicateAccion(id: string) {
    const src = acciones.find((a) => a.id === id);
    if (!src) return;
    const copy: Accion = {
      ...src,
      id: newId(),
      nombre: `${src.nombre} (copia)`,
      media: { ...src.media },
      comandos: src.comandos.map((c) => ({ ...c, params: { ...c.params } })),
    };
    client?.send("acciones", { kind: "set", acciones: [...acciones, copy] });
  }

  async function testAccion(accion: Accion) {
    if (!client) return;
    if (accion.comandos.length === 0) return;
    setTestingId(accion.id);
    for (const c of accion.comandos) {
      try {
        await client.sendManualCommand({
          action: c.modActionId,
          params: sanitizeUnknownParams(c.params),
        });
      } catch {
        // el feedback real es el comando ejecutado en el juego; no se muestra en la UI
      }
    }
    setTestingId(null);
  }

  // --- CRUD eventos ---
  function saveEvento(evento: Evento) {
    const exists = eventos.some((e) => e.id === evento.id);
    const next = exists
      ? eventos.map((e) => (e.id === evento.id ? evento : e))
      : [...eventos, evento];
    client?.send("eventos", { kind: "set", eventos: next });
    setEventoModal(null);
    setError(null);
  }

  function deleteEvento(id: string) {
    client?.send("eventos", { kind: "set", eventos: eventos.filter((e) => e.id !== id) });
  }

  function toggleEventoActivo(id: string) {
    client?.send("eventos", {
      kind: "set",
      eventos: eventos.map((e) => (e.id === id ? { ...e, activo: !e.activo } : e)),
    });
  }

  const filteredAcciones = acciones.filter((a) =>
    a.nombre.toLowerCase().includes(accionSearch.toLowerCase()),
  );
  const q = eventoSearch.toLowerCase();
  const filteredEventos = eventos.filter((e) => eventoSearchText(e, acciones, gifts).includes(q));

  return (
    <div style={sectionCardStyle}>
      <div>
        <span style={eyebrowStyle}>GENERAL</span>
        <h2 style={sectionTitleStyle}>Acciones y Eventos</h2>
        <p style={sectionDescStyle}>
          Aquí puedes definir tus acciones y eventos personalizados (desencadenantes). Por
          ejemplo, puedes mostrar una alerta o ejecutar un comando de este mod con un regalo
          específico.
          <br />
          Para esto, primero debes definir la acción y luego el evento. Se requiere el{" "}
          <a href="#overlay" style={{ color: "#5B7CFA", fontWeight: 600 }}>
            Overlay de este mod
          </a>{" "}
          para ver las alertas en tu stream.
        </p>
      </div>

      {/* ------------------------------- Acciones ------------------------------- */}
      <div style={accionesBlockStyle}>
        <div>
          <h3 style={subTitleStyle}>Acciones</h3>
          <p style={subDescStyle}>
            ¿Qué quieres que ocurra? Aquí puedes crear nuevas acciones y editar las existentes.
            Puedes vincular estas acciones a eventos a continuación.
          </p>
        </div>

        <div style={toolbarStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button type="button" onClick={() => setAccionModal({ initial: null })} style={createButtonStyle}>
              + Crear nueva Acción
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#C4C5CC", cursor: "pointer" }}>
              <button type="button" onClick={() => setHabilitado(!habilitado)} style={checkBoxStyle}>
                {habilitado ? "✓" : ""}
              </button>
              Habilitado
            </label>
          </div>
          <div style={searchBoxStyle}>
            <span style={{ color: "#5B5D66", fontSize: 12, marginRight: 6 }}>⌕</span>
            <input
              style={searchInputStyle}
              value={accionSearch}
              placeholder="Search existing actions..."
              onChange={(e) => setAccionSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={tableContainerStyle}>
          <table style={{ ...tableStyle, minWidth: 940 }}>
            <colgroup>
              <col style={{ width: 88 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 84 }} />
              <col style={{ width: 112 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 82 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 56 }} />
              <col />
            </colgroup>
            <thead>
              <tr style={headerRowStyle}>
                <th style={thStyle} />
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Pantalla</th>
                <th style={thStyle}>Duración (seg.)</th>
                <th style={thStyle}>Puntos +/-</th>
                <th style={thCenterStyle}>Animación</th>
                <th style={thCenterStyle}>Imagen</th>
                <th style={thCenterStyle}>Sonido</th>
                <th style={thCenterStyle}>Video</th>
                <th style={thStyle}>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {filteredAcciones.length === 0 ? (
                <tr>
                  <td colSpan={10} style={emptyStyle}>
                    No hay acciones todavía. Crea una con "+ Crear nueva Acción".
                  </td>
                </tr>
              ) : (
                filteredAcciones.map((a) => (
                  <tr key={a.id}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <button
                          type="button"
                          title="Probar"
                          onClick={() => testAccion(a)}
                          disabled={testingId !== null}
                          style={iconButtonStyle}
                        >
                          ▶
                        </button>
                        <button type="button" title="Editar" onClick={() => setAccionModal({ initial: a })} style={iconButtonStyle}>
                          ✎
                        </button>
                        <button type="button" title="Duplicar" onClick={() => duplicateAccion(a.id)} style={iconButtonStyle}>
                          ⧉
                        </button>
                        <button type="button" title="Borrar" onClick={() => deleteAccion(a.id)} style={{ ...iconButtonStyle, color: "#E5484D" }}>
                          🗑
                        </button>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600 }}>{a.nombre}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#C4C5CC" }}>{a.pantalla ?? "—"}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#C4C5CC" }}>{a.duracionSeg}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#C4C5CC" }}>{a.puntos > 0 ? `+${a.puntos}` : a.puntos}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#5B5D66", textAlign: "center" }}>{a.media.animacion ? "☑" : "☐"}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#5B5D66", textAlign: "center" }}>{a.media.imagen ? "☑" : "☐"}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#5B5D66", textAlign: "center" }}>{a.media.sonido ? "☑" : "☐"}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#5B5D66", textAlign: "center" }}>{a.media.video ? "☑" : "☐"}</td>
                    <td style={{ ...tdStyle, fontSize: 11.5, color: "#9A9CA5" }}>{a.descripcion || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------- Eventos ------------------------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h3 style={subTitleStyle}>Eventos</h3>
          <p style={subDescStyle}>
            Aquí puedes definir qué desencadenará tus acciones. Incluye los disparadores de
            comunidad (seguir, compartir, SuperFan, likes) junto con cualquier otro evento — todos
            usan el mismo motor.
          </p>
        </div>

        <div style={toolbarStyle}>
          <button type="button" onClick={() => setEventoModal({ initial: null })} style={createButtonStyle}>
            + Crear nuevo Evento
          </button>
          <div style={searchBoxStyle}>
            <span style={{ color: "#5B5D66", fontSize: 12, marginRight: 6 }}>⌕</span>
            <input
              style={searchInputStyle}
              value={eventoSearch}
              placeholder="Search existing events..."
              onChange={(e) => setEventoSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={tableContainerStyle}>
          <table style={tableStyle}>
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 68 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 230 }} />
              <col style={{ width: 230 }} />
              <col />
            </colgroup>
            <thead>
              <tr style={headerRowStyle}>
                <th style={thStyle} />
                <th style={thCenterStyle}>Activo</th>
                <th style={thStyle}>Usuario</th>
                <th style={thStyle}>Desencadenante</th>
                <th style={thStyle}>Trigger</th>
                <th style={thStyle}>Acción(es)</th>
              </tr>
            </thead>
            <tbody>
              {filteredEventos.length === 0 ? (
                <tr>
                  <td colSpan={6} style={emptyStyle}>
                    No hay eventos todavía. Crea uno con "+ Crear nuevo Evento".
                  </td>
                </tr>
              ) : (
                filteredEventos.map((e) => (
                  <tr key={e.id}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button type="button" title="Editar" onClick={() => setEventoModal({ initial: e })} style={iconButtonStyle}>
                          ✎
                        </button>
                        <button type="button" title="Borrar" onClick={() => deleteEvento(e.id)} style={{ ...iconButtonStyle, color: "#E5484D" }}>
                          🗑
                        </button>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <button
                        type="button"
                        title={e.activo ? "Desactivar" : "Activar"}
                        onClick={() => toggleEventoActivo(e.id)}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          border: `1px solid ${e.activo ? ACCENT : "#3A3C44"}`,
                          background: e.activo ? ACCENT : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#FFFFFF",
                          fontSize: 10,
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        {e.activo ? "✓" : ""}
                      </button>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#9A9CA5", whiteSpace: "normal" }}>{describeQuien(e)}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: 600, whiteSpace: "normal" }}>{PORQUE_LABELS[e.porque]}</td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      <TriggerCell trigger={triggerFor(e, gifts)} />
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: "#C4C5CC" }}>{accionNamesFor(acciones, eventoAccionesIds(e))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 12px", background: "#2A1416", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12.5 }}>
          {error}
        </div>
      )}

      {accionModal && (
        <AccionModal
          catalog={catalog}
          initial={accionModal.initial}
          onSave={saveAccion}
          onClose={() => setAccionModal(null)}
        />
      )}

      {eventoModal && (
        <EventoModal
          acciones={acciones}
          initial={eventoModal.initial}
          onSave={saveEvento}
          onClose={() => setEventoModal(null)}
          client={client}
        />
      )}
    </div>
  );
}

const ACCENT = "#E23A57";

const sectionCardStyle: React.CSSProperties = {
  padding: 22,
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 16,
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#5B7CFA",
  letterSpacing: "0.06em",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 17,
  fontWeight: 700,
};

const sectionDescStyle: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12.5,
  color: "#9A9CA5",
  lineHeight: 1.6,
  maxWidth: 640,
};

const subTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14.5,
  fontWeight: 700,
  color: "#5B7CFA",
};

const subDescStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "#9A9CA5",
};

const accionesBlockStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingBottom: 20,
  borderBottom: "1px solid #2A2C33",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const createButtonStyle: React.CSSProperties = {
  padding: "0 14px",
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: ACCENT,
  color: "#FFFFFF",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
  cursor: "pointer",
  border: "none",
};

const checkBoxStyle: React.CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: 4,
  background: ACCENT,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: "#FFFFFF",
  fontSize: 9,
  lineHeight: 1,
  border: "none",
  cursor: "pointer",
  padding: 0,
};

const searchBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  padding: "0 12px",
  height: 32,
  width: 200,
  flexShrink: 0,
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

const tableContainerStyle: React.CSSProperties = {
  border: "1px solid #2A2C33",
  borderRadius: 10,
  overflow: "hidden",
  overflowX: "auto",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: "fixed",
};

const headerRowStyle: React.CSSProperties = {
  background: "#0E0F12",
};

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

const thCenterStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "center",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "10px 12px",
  borderTop: "1px solid #22242B",
  whiteSpace: "nowrap",
  boxSizing: "border-box",
};

const emptyStyle: React.CSSProperties = {
  padding: 18,
  color: "#5B5D66",
  fontSize: 12.5,
  textAlign: "center",
};

const iconButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B7CFA",
  fontSize: 11,
  cursor: "pointer",
  padding: "0 2px",
};
