import { useState } from "react";
import type {
  Accion,
  Evento,
  EventoModoDisparo,
  EventoPorque,
  EventoQuien,
} from "@streamtok/shared";
import {
  MODO_DISPARO_LABELS,
  PORQUE_OPTIONS,
  PROXIMAMENTE_PORQUE,
  QUIEN_OPTIONS,
} from "../lib/labels";

function newId(): string {
  return crypto.randomUUID();
}

function numOr(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

const PROXIMAMENTE_NOTE =
  "El motor todavía no puede detectar este tipo de evento (ver ADR 0005) — " +
  "el Evento se guardará pero no se disparará hasta que se implemente.";

/**
 * Modal "Nuevo Evento" / "Editar Evento" (issue #24). Dos preguntas (¿Quién? y
 * ¿Por qué?), cada `porque` muestra únicamente su propio bloque de campos
 * condicionales, y un buscador para asociar una o más Acciones existentes.
 */
export function EventoModal({
  acciones,
  initial,
  onSave,
  onClose,
}: {
  acciones: Accion[];
  initial: Evento | null;
  onSave: (evento: Evento) => void;
  onClose: () => void;
}) {
  const [quien, setQuien] = useState<EventoQuien>(initial?.quien ?? "todos");
  const [usuarioEspecifico, setUsuarioEspecifico] = useState(initial?.usuarioEspecifico ?? "");
  const [numeroDonantesTop, setNumeroDonantesTop] = useState<number>(initial?.numeroDonantesTop ?? 3);
  const [porque, setPorque] = useState<EventoPorque>(initial?.porque ?? "unirse");
  const [nivelEquipoRequerido, setNivelEquipoRequerido] = useState<number>(
    initial?.nivelEquipoRequerido ?? 0,
  );
  const [nivelPuntosRequerido, setNivelPuntosRequerido] = useState<number>(
    initial?.nivelPuntosRequerido ?? 0,
  );
  const [comando, setComando] = useState(initial?.comando ?? "");
  const [cantidadMinimaLikes, setCantidadMinimaLikes] = useState<number>(
    initial?.cantidadMinimaLikes ?? 15,
  );
  const [valorMinimoMonedas, setValorMinimoMonedas] = useState<number>(
    initial?.valorMinimoMonedas ?? 1,
  );
  const [giftName, setGiftName] = useState(initial?.giftName ?? "");
  const [emoteId, setEmoteId] = useState(initial?.emoteId ?? "");
  const [stickerId, setStickerId] = useState(initial?.stickerId ?? "");
  const [nombreProductoContiene, setNombreProductoContiene] = useState(
    initial?.nombreProductoContiene ?? "",
  );
  const [modoDisparo, setModoDisparo] = useState<EventoModoDisparo>(initial?.modoDisparo ?? "todas");
  const [accionesIds, setAccionesIds] = useState<string[]>(initial?.accionesIds ?? []);
  const [accionSearch, setAccionSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filteredAcciones = acciones.filter((a) =>
    a.nombre.toLowerCase().includes(accionSearch.toLowerCase()),
  );

  function toggleAccion(id: string) {
    setAccionesIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    setError(null);

    if (accionesIds.length === 0) {
      setError("Selecciona al menos una Acción.");
      return;
    }
    if (quien === "usuarioEspecifico" && !usuarioEspecifico.trim()) {
      setError("El username es obligatorio para 'Un Usuario Específico'.");
      return;
    }
    if (porque === "comando") {
      const cmd = comando.trim();
      if (!cmd) {
        setError("El comando es obligatorio.");
        return;
      }
      if (!/^[!/]/.test(cmd)) {
        setError('El comando debe empezar con "!" o "/".');
        return;
      }
    }
    if (porque === "regaloEspecifico" && !giftName.trim()) {
      setError("Escribe el nombre exacto del regalo.");
      return;
    }
    if (porque === "emoteSuscriptor" && !emoteId.trim()) {
      setError("Escribe el emote de suscriptor.");
      return;
    }
    if (porque === "stickerFanClub" && !stickerId.trim()) {
      setError("Escribe el sticker del club de fans.");
      return;
    }
    if (porque === "compraTiktokShop" && !nombreProductoContiene.trim()) {
      setError("Indica el nombre del producto.");
      return;
    }

    const evento: Evento = {
      id: initial?.id ?? newId(),
      activo: initial?.activo ?? true,
      quien,
      porque,
      modoDisparo,
      accionesIds,
      usuarioEspecifico: quien === "usuarioEspecifico" ? usuarioEspecifico.trim() : undefined,
      numeroDonantesTop: quien === "donanteTop" ? numOr(numeroDonantesTop, 3) : undefined,
      nivelEquipoRequerido:
        porque === "unirse" || porque === "primeraActividad" || porque === "comando"
          ? numOr(nivelEquipoRequerido, 0)
          : undefined,
      nivelPuntosRequerido: porque === "comando" ? numOr(nivelPuntosRequerido, 0) : undefined,
      comando: porque === "comando" ? comando.trim() : undefined,
      cantidadMinimaLikes: porque === "likes" ? numOr(cantidadMinimaLikes, 15) : undefined,
      valorMinimoMonedas: porque === "regaloValorMinimo" ? numOr(valorMinimoMonedas, 1) : undefined,
      giftId: porque === "regaloEspecifico" ? giftName.trim() : undefined,
      giftName: porque === "regaloEspecifico" ? giftName.trim() : undefined,
      emoteId: porque === "emoteSuscriptor" ? emoteId.trim() : undefined,
      stickerId: porque === "stickerFanClub" ? stickerId.trim() : undefined,
      nombreProductoContiene:
        porque === "compraTiktokShop" ? nombreProductoContiene.trim() : undefined,
    };

    onSave(evento);
  }

  const esProximamente = PROXIMAMENTE_PORQUE.has(porque);

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {initial ? "Editar Evento" : "Nuevo Evento"}
          </span>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          <label style={labelStyle}>
            ¿Quién?
            <select style={inputStyle} value={quien} onChange={(e) => setQuien(e.target.value as EventoQuien)}>
              {QUIEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {quien === "usuarioEspecifico" && (
            <label style={labelStyle}>
              Username
              <input
                style={inputStyle}
                value={usuarioEspecifico}
                placeholder="@usuario"
                onChange={(e) => setUsuarioEspecifico(e.target.value)}
              />
            </label>
          )}

          {quien === "donanteTop" && (
            <label style={labelStyle}>
              Número permitido de principales donantes
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(numeroDonantesTop) ? numeroDonantesTop : ""}
                min={1}
                onChange={(e) =>
                  setNumeroDonantesTop(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
            </label>
          )}

          <label style={labelStyle}>
            ¿Por qué?
            <select style={inputStyle} value={porque} onChange={(e) => setPorque(e.target.value as EventoPorque)}>
              {PORQUE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {PROXIMAMENTE_PORQUE.has(o.value) ? " (próximamente)" : ""}
                </option>
              ))}
            </select>
          </label>

          {esProximamente && (
            <div style={proximamenteNoteStyle}>{PROXIMAMENTE_NOTE}</div>
          )}

          {(porque === "unirse" || porque === "primeraActividad") && (
            <label style={labelStyle}>
              Nivel de equipo requerido
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(nivelEquipoRequerido) ? nivelEquipoRequerido : ""}
                min={0}
                onChange={(e) =>
                  setNivelEquipoRequerido(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
            </label>
          )}

          {porque === "likes" && (
            <label style={labelStyle}>
              Cantidad mínima de likes
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(cantidadMinimaLikes) ? cantidadMinimaLikes : ""}
                min={1}
                onChange={(e) =>
                  setCantidadMinimaLikes(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
            </label>
          )}

          {porque === "comando" && (
            <>
              <label style={labelStyle}>
                Comando
                <input
                  style={inputStyle}
                  value={comando}
                  placeholder="!drop o /drop"
                  onChange={(e) => setComando(e.target.value)}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Nivel de equipo
                  <input
                    type="number"
                    style={inputStyle}
                    value={Number.isFinite(nivelEquipoRequerido) ? nivelEquipoRequerido : ""}
                    min={0}
                    onChange={(e) =>
                      setNivelEquipoRequerido(e.target.value === "" ? NaN : Number(e.target.value))
                    }
                  />
                </label>
                <label style={labelStyle}>
                  Nivel de puntos
                  <input
                    type="number"
                    style={inputStyle}
                    value={Number.isFinite(nivelPuntosRequerido) ? nivelPuntosRequerido : ""}
                    min={0}
                    onChange={(e) =>
                      setNivelPuntosRequerido(e.target.value === "" ? NaN : Number(e.target.value))
                    }
                  />
                </label>
              </div>
            </>
          )}

          {porque === "regaloValorMinimo" && (
            <label style={labelStyle}>
              Valor mínimo en monedas
              <input
                type="number"
                style={inputStyle}
                value={Number.isFinite(valorMinimoMonedas) ? valorMinimoMonedas : ""}
                min={1}
                onChange={(e) =>
                  setValorMinimoMonedas(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
            </label>
          )}

          {porque === "regaloEspecifico" && (
            <label style={labelStyle}>
              Regalo
              <input
                style={inputStyle}
                value={giftName}
                placeholder="Nombre exacto del regalo"
                onChange={(e) => setGiftName(e.target.value)}
              />
              <span style={noteStyle}>
                Catálogo real de regalos pendiente — por ahora escribe el nombre exacto del regalo.
              </span>
            </label>
          )}

          {porque === "emoteSuscriptor" && (
            <label style={labelStyle}>
              Emote de suscriptor
              <input
                style={inputStyle}
                value={emoteId}
                placeholder="Emote exacto"
                onChange={(e) => setEmoteId(e.target.value)}
              />
              <span style={noteStyle}>
                Catálogo real de emotes pendiente — por ahora escribe el emote exacto.
              </span>
            </label>
          )}

          {porque === "stickerFanClub" && (
            <label style={labelStyle}>
              Sticker del club de fans
              <input
                style={inputStyle}
                value={stickerId}
                placeholder="Sticker exacto"
                onChange={(e) => setStickerId(e.target.value)}
              />
              <span style={noteStyle}>
                Catálogo real de stickers pendiente — por ahora escribe el sticker exacto.
              </span>
            </label>
          )}

          {porque === "compraTiktokShop" && (
            <label style={labelStyle}>
              Nombre de producto contiene
              <input
                style={inputStyle}
                value={nombreProductoContiene}
                onChange={(e) => setNombreProductoContiene(e.target.value)}
              />
            </label>
          )}

          <label style={labelStyle}>
            Modo de disparo
            <select
              style={inputStyle}
              value={modoDisparo}
              onChange={(e) => setModoDisparo(e.target.value as EventoModoDisparo)}
            >
              <option value="todas">{MODO_DISPARO_LABELS.todas}</option>
              <option value="unaAlAzar">{MODO_DISPARO_LABELS.unaAlAzar}</option>
            </select>
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#9A9CA5" }}>
              Acciones asociadas ({accionesIds.length} seleccionada{accionesIds.length === 1 ? "" : "s"})
            </span>
            <input
              style={inputStyle}
              value={accionSearch}
              placeholder="Buscar acciones…"
              onChange={(e) => setAccionSearch(e.target.value)}
            />
            {acciones.length === 0 ? (
              <div style={noteStyle}>
                No hay Acciones creadas todavía. Crea una Acción primero.
              </div>
            ) : filteredAcciones.length === 0 ? (
              <div style={noteStyle}>Sin resultados.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                {filteredAcciones.map((a) => {
                  const selected = accionesIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAccion(a.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        padding: "8px 10px",
                        background: selected ? "#1F222B" : "#17181D",
                        border: `1px solid ${selected ? "#5B7CFA" : "#2A2C33"}`,
                        borderRadius: 8,
                        color: selected ? "#F4F4F5" : "#C4C5CC",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      <input type="checkbox" checked={selected} readOnly style={{ pointerEvents: "none" }} />
                      {a.nombre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div style={{ padding: "8px 10px", background: "#2A1416", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button type="button" onClick={onClose} style={ghostButtonStyle}>
            Cancelar
          </button>
          <button type="button" onClick={submit} style={primaryButtonStyle}>
            {initial ? "Guardar cambios" : "Crear Evento"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#14151A",
  border: "1px solid #2A2C33",
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 18px",
  borderBottom: "1px solid #2A2C33",
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#9A9CA5",
  fontSize: 14,
  cursor: "pointer",
  padding: 4,
};

const bodyStyle: React.CSSProperties = {
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  padding: "14px 18px",
  borderTop: "1px solid #2A2C33",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#9A9CA5",
};

const noteStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#9A9CA5",
};

const proximamenteNoteStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#2A2410",
  border: "1px solid #8a6d1f",
  borderRadius: 8,
  color: "#E8C766",
  fontSize: 12,
};

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

const ghostButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "transparent",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#C4C5CC",
  fontSize: 13,
  cursor: "pointer",
};
