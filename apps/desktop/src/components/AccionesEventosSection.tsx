import { useEffect, useState } from "react";
import type {
  Accion,
  AccionesMessage,
  Evento,
  EventosMessage,
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

function eventoSearchText(e: Evento, acciones: Accion[]): string {
  return [
    describeQuien(e),
    PORQUE_LABELS[e.porque],
    e.usuarioEspecifico ?? "",
    e.comando ?? "",
    accionNamesFor(acciones, e.accionesIds),
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
  const [error, setError] = useState<string | null>(null);

  const [accionModal, setAccionModal] = useState<{ initial: Accion | null } | null>(null);
  const [eventoModal, setEventoModal] = useState<{ initial: Evento | null } | null>(null);

  const [accionSearch, setAccionSearch] = useState("");
  const [eventoSearch, setEventoSearch] = useState("");
  const [habilitado, setHabilitado] = useState(true);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

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
    if (accion.comandos.length === 0) {
      setTestResult(`"${accion.nombre}" no tiene comandos.`);
      return;
    }
    setTestingId(accion.id);
    setTestResult(null);
    const results: string[] = [];
    for (const c of accion.comandos) {
      try {
        const resp = await client.sendManualCommand({
          action: c.modActionId,
          params: sanitizeUnknownParams(c.params),
        });
        if (resp.kind === "ack") {
          results.push(
            resp.ack.ok ? `✓ ${c.modActionId}` : `✕ ${c.modActionId} — ${resp.ack.error ?? "sin detalle"}`,
          );
        } else {
          results.push(`✕ ${c.modActionId} — ${resp.message}`);
        }
      } catch (err) {
        results.push(`✕ ${c.modActionId} — ${(err as Error).message}`);
      }
    }
    setTestResult(results.join(" · "));
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
  const filteredEventos = eventos.filter((e) => eventoSearchText(e, acciones).includes(q));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ------------------------------- Acciones ------------------------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setAccionModal({ initial: null })} style={primaryButtonStyle}>
            + Crear nueva Acción
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#C4C5CC", cursor: "pointer" }}>
            <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} />
            Habilitado
          </label>
          <input
            style={{ ...inputStyle, maxWidth: 240, marginLeft: "auto" }}
            value={accionSearch}
            placeholder="Search existing actions..."
            onChange={(e) => setAccionSearch(e.target.value)}
          />
        </div>

        {testResult && (
          <div style={{ padding: "8px 10px", background: "#17181D", border: "1px solid #2A2C33", borderRadius: 8, fontSize: 12, color: "#C4C5CC" }}>
            {testResult}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle} />
                <th style={thStyle}>Nombre</th>
                <th style={thStyle}>Pantalla</th>
                <th style={thStyle}>Duración (seg.)</th>
                <th style={thStyle}>Puntos +/-</th>
                <th style={thStyle}>Animación</th>
                <th style={thStyle}>Imagen</th>
                <th style={thStyle}>Sonido</th>
                <th style={thStyle}>Video</th>
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
                  <tr key={a.id} style={rowStyle}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
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
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{a.nombre}</td>
                    <td style={tdStyle}>{a.pantalla ?? "—"}</td>
                    <td style={tdStyle}>{a.duracionSeg}</td>
                    <td style={tdStyle}>{a.puntos > 0 ? `+${a.puntos}` : a.puntos}</td>
                    <td style={tdStyle}>{a.media.animacion ? "✓" : "—"}</td>
                    <td style={tdStyle}>{a.media.imagen ? "✓" : "—"}</td>
                    <td style={tdStyle}>{a.media.sonido ? "✓" : "—"}</td>
                    <td style={tdStyle}>{a.media.video ? "✓" : "—"}</td>
                    <td style={{ ...tdStyle, color: "#9A9CA5" }}>{a.descripcion || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------- Eventos ------------------------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={() => setEventoModal({ initial: null })} style={primaryButtonStyle}>
            + Crear nuevo Evento
          </button>
          <input
            style={{ ...inputStyle, maxWidth: 240, marginLeft: "auto" }}
            value={eventoSearch}
            placeholder="Search existing events..."
            onChange={(e) => setEventoSearch(e.target.value)}
          />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle} />
                <th style={thStyle}>Activo</th>
                <th style={thStyle}>Usuario</th>
                <th style={thStyle}>Desencadenante</th>
                <th style={thStyle}>Acción(es)</th>
              </tr>
            </thead>
            <tbody>
              {filteredEventos.length === 0 ? (
                <tr>
                  <td colSpan={5} style={emptyStyle}>
                    No hay eventos todavía. Crea uno con "+ Crear nuevo Evento".
                  </td>
                </tr>
              ) : (
                filteredEventos.map((e) => (
                  <tr key={e.id} style={rowStyle}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <button type="button" title="Editar" onClick={() => setEventoModal({ initial: e })} style={iconButtonStyle}>
                        ✎
                      </button>
                      <button type="button" title="Borrar" onClick={() => deleteEvento(e.id)} style={{ ...iconButtonStyle, color: "#E5484D" }}>
                        🗑
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={e.activo}
                          onChange={() => toggleEventoActivo(e.id)}
                        />
                      </label>
                    </td>
                    <td style={tdStyle}>{describeQuien(e)}</td>
                    <td style={tdStyle}>{PORQUE_LABELS[e.porque]}</td>
                    <td style={{ ...tdStyle, color: "#9A9CA5" }}>{accionNamesFor(acciones, e.accionesIds)}</td>
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
        />
      )}
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#E23A57",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: 820,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 700,
  color: "#9A9CA5",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "8px 10px",
  borderBottom: "1px solid #2A2C33",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "10px",
  borderBottom: "1px solid #1F222B",
  whiteSpace: "nowrap",
};

const rowStyle: React.CSSProperties = {
  background: "#17181D",
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
  color: "#C4C5CC",
  fontSize: 13,
  cursor: "pointer",
  padding: "2px 6px",
};
