import { useEffect, useState } from "react";
import type {
  Accion,
  Evento,
  EventoModoDisparo,
  EventoPorque,
  EventoQuien,
  GiftCatalogEntry,
  GiftCatalogMessage,
} from "@streamtok/shared";
import {
  MODO_DISPARO_LABELS,
  PORQUE_LABELS,
  PORQUE_OPTIONS,
  PROXIMAMENTE_PORQUE,
  QUIEN_OPTIONS,
} from "../lib/labels";
import type { SidecarClient } from "../lib/ws-client";

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
  client,
}: {
  acciones: Accion[];
  initial: Evento | null;
  onSave: (evento: Evento) => void;
  onClose: () => void;
  client: SidecarClient | null;
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
  const [giftId, setGiftId] = useState(initial?.giftId ?? "");
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogEntry[]>([]);
  const [emoteId, setEmoteId] = useState(initial?.emoteId ?? "");
  const [stickerId, setStickerId] = useState(initial?.stickerId ?? "");
  const [nombreProductoContiene, setNombreProductoContiene] = useState(
    initial?.nombreProductoContiene ?? "",
  );
  const [modoDisparo, setModoDisparo] = useState<EventoModoDisparo>(initial?.modoDisparo ?? "todas");
  const [accionesIds, setAccionesIds] = useState<string[]>(initial?.accionesIds ?? []);
  const [accionSearch, setAccionSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "gift-catalog") return;
      const msg = evt.payload as GiftCatalogMessage;
      if (msg.kind === "state") setGiftCatalog(msg.gifts);
    });
    // Snapshot bajo demanda (patrón get-state, como profiles): el modal puede
    // montarse después de que el snapshot de conexión ya pasó.
    client.send("gift-catalog", { kind: "get-state" });
    return off;
  }, [client]);

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
    if (porque === "regaloEspecifico" && !giftId) {
      setError("Elige un regalo del catálogo.");
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
      giftId: porque === "regaloEspecifico" ? giftId : undefined,
      giftName:
        porque === "regaloEspecifico"
          ? (giftCatalog.find((g) => g.id === giftId)?.name ?? initial?.giftName ?? "")
          : undefined,
      emoteId: porque === "emoteSuscriptor" ? emoteId.trim() : undefined,
      stickerId: porque === "stickerFanClub" ? stickerId.trim() : undefined,
      nombreProductoContiene:
        porque === "compraTiktokShop" ? nombreProductoContiene.trim() : undefined,
    };

    onSave(evento);
  }

  const esProximamente = PROXIMAMENTE_PORQUE.has(porque);

  const hasCampos =
    porque === "unirse" ||
    porque === "primeraActividad" ||
    porque === "likes" ||
    porque === "comando" ||
    porque === "regaloValorMinimo" ||
    porque === "regaloEspecifico" ||
    porque === "emoteSuscriptor" ||
    porque === "stickerFanClub" ||
    porque === "compraTiktokShop";

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <span style={eyebrowStyle}>MODAL · ABIERTO DESDE GTA V CHAOS MOD</span>
        <div style={titleRowStyle}>
          <h2 style={titleStyle}>{initial ? "Editar Evento" : "Nuevo Evento"}</h2>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          <div>
            <span style={questionLabelStyle}>¿Quién puede desencadenar el evento?</span>
            <div style={radioListStyle}>
              {QUIEN_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setQuien(o.value)}
                  style={radioRowStyle}
                >
                  <span style={radioOuterStyle(quien === o.value)}>
                    <span style={radioInnerStyle(quien === o.value)} />
                  </span>
                  <span style={{ fontSize: 13, color: "#F4F4F5" }}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

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

          <div>
            <span style={questionLabelStyle}>¿Por qué se desencadenará el evento?</span>
            <div style={radioListStyle}>
              {PORQUE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setPorque(o.value)}
                  style={radioRowStyle}
                >
                  <span style={radioOuterStyle(porque === o.value)}>
                    <span style={radioInnerStyle(porque === o.value)} />
                  </span>
                  <span style={{ fontSize: 13, color: "#F4F4F5" }}>
                    {o.label}
                    {PROXIMAMENTE_PORQUE.has(o.value) ? " (próximamente)" : ""}
                  </span>
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 10.5, color: "#5B5D66" }}>
              El campo de abajo cambia según lo elegido acá (ej. "regalo específico" pide el
              regalo, "valor mínimo" pide un número).
            </p>
          </div>

          {esProximamente && <div style={proximamenteNoteStyle}>{PROXIMAMENTE_NOTE}</div>}

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

          {hasCampos && (
            <div style={conditionalBlockStyle}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5B7CFA", letterSpacing: "0.04em" }}>
                CAMPOS DE ESTE TRIGGER — {PORQUE_LABELS[porque].toUpperCase()}
              </span>
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
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <label style={{ fontSize: 10.5, color: "#9A9CA5" }}>Regalo</label>
                  {giftCatalog.length === 0 ? (
                    <div style={giftEmptyStyle}>
                      Aún no hay regalos aprendidos. Envía un regalo en vivo y vuelve a abrir este
                      modal para poder elegirlo.
                    </div>
                  ) : (
                    <GiftPicker value={giftId} gifts={giftCatalog} onSelect={setGiftId} />
                  )}
                </div>
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
            </div>
          )}

          <label style={labelStyle}>
            Modo de disparo
            <select
              style={selectStyle}
              value={modoDisparo}
              onChange={(e) => setModoDisparo(e.target.value as EventoModoDisparo)}
            >
              <option value="todas">{MODO_DISPARO_LABELS.todas}</option>
              <option value="unaAlAzar">{MODO_DISPARO_LABELS.unaAlAzar}</option>
            </select>
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>
              Desencadenar todas estas acciones
            </label>
            <div style={chipsBoxStyle}>
              {accionesIds.length === 0 ? (
                <span style={{ color: "#5B5D66", fontSize: 12.5 }}>Buscar acción...</span>
              ) : (
                accionesIds.map((id) => {
                  const a = acciones.find((x) => x.id === id);
                  return (
                    <span key={id} style={chipStyle}>
                      {a?.nombre ?? id}
                      <button type="button" onClick={() => toggleAccion(id)} style={chipRemoveStyle}>
                        ✕
                      </button>
                    </span>
                  );
                })
              )}
            </div>
          </div>

          <input
            style={inputStyle}
            value={accionSearch}
            placeholder="Buscar acciones…"
            onChange={(e) => setAccionSearch(e.target.value)}
          />

          {acciones.length === 0 ? (
            <div style={noteStyle}>No hay Acciones creadas todavía. Crea una Acción primero.</div>
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
                    style={actionListItemStyle(selected)}
                  >
                    <input type="checkbox" checked={selected} readOnly style={{ pointerEvents: "none" }} />
                    {a.nombre}
                  </button>
                );
              })}
            </div>
          )}

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
            ✓ Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function GiftPicker({
  value,
  gifts,
  onSelect,
}: {
  value: string;
  gifts: GiftCatalogEntry[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = gifts.find((g) => g.id === value);

  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={giftPickerButtonStyle}>
        {selected ? (
          <>
            <img src={selected.imageUrl} alt="" referrerPolicy="no-referrer" style={giftThumbStyle} />
            <span style={giftPickerLabelStyle}>{selected.name}</span>
            <span style={giftCostStyle}>{selected.cost} 🪙</span>
          </>
        ) : (
          <span style={{ flex: 1, textAlign: "left", fontSize: 12.5, color: "#5B5D66" }}>
            Elegir regalo…
          </span>
        )}
        <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={() => setOpen(false)} />
          <div style={giftDropdownStyle}>
            {gifts.map((g) => {
              const isSelected = g.id === value;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onSelect(g.id);
                    setOpen(false);
                  }}
                  style={{ ...giftOptionStyle, background: isSelected ? "#1E2027" : "transparent" }}
                >
                  <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" style={giftThumbStyle} />
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      fontSize: 12.5,
                      color: isSelected ? "#F4F4F5" : "#C4C5CC",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {g.name}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>{g.cost} 🪙</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const ACCENT = "#E23A57";

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(14, 15, 18, 0.61)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  zIndex: 100,
  padding: 40,
  overflowY: "auto",
};

const cardStyle: React.CSSProperties = {
  width: 560,
  maxWidth: "100%",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 16,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 18,
  boxShadow: "0 20px 60px #00000080",
  boxSizing: "border-box",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#5B7CFA",
  letterSpacing: "0.06em",
};

const titleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 17,
  fontWeight: 700,
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B5D66",
  fontSize: 16,
  cursor: "pointer",
  padding: 0,
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 14px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#F4F4F5",
  fontSize: 13,
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  color: "#F4F4F5",
  fontSize: 12,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 10.5,
  color: "#9A9CA5",
};

const questionLabelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "#C4C5CC",
};

const radioListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
};

const radioRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
  color: "#F4F4F5",
};

function radioOuterStyle(sel: boolean): React.CSSProperties {
  return {
    width: 15,
    height: 15,
    borderRadius: "50%",
    border: `1px solid ${sel ? ACCENT : "#3A3C44"}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

function radioInnerStyle(sel: boolean): React.CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: sel ? ACCENT : "transparent",
  };
}

const conditionalBlockStyle: React.CSSProperties = {
  padding: "14px 16px",
  background: "#141922",
  border: "1px solid #22303F",
  borderRadius: 10,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const chipsBoxStyle: React.CSSProperties = {
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  padding: "6px 14px",
  boxSizing: "border-box",
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 9px",
  background: ACCENT,
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "#FFFFFF",
};

const chipRemoveStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#FFFFFF",
  fontSize: 11,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

function actionListItemStyle(selected: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    textAlign: "left",
    padding: "8px 10px",
    background: selected ? "#1E2027" : "#17181D",
    border: `1px solid ${selected ? "#5B7CFA" : "#2A2C33"}`,
    borderRadius: 8,
    color: selected ? "#F4F4F5" : "#C4C5CC",
    fontSize: 12.5,
    cursor: "pointer",
  };
}

const noteStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: "#5B5D66",
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
  padding: "0 18px",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: ACCENT,
  border: "none",
  borderRadius: 9,
  color: "#FFFFFF",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "0 18px",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid #2A2C33",
  borderRadius: 9,
  color: "#C4C5CC",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const giftPickerButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  cursor: "pointer",
  color: "#F4F4F5",
  boxSizing: "border-box",
};

const giftThumbStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 4,
  objectFit: "cover",
  flexShrink: 0,
};

const giftPickerLabelStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "left",
  fontSize: 12.5,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const giftCostStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#9A9CA5",
  whiteSpace: "nowrap",
};

const giftDropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 16,
  display: "flex",
  flexDirection: "column",
  maxHeight: 220,
  overflowY: "auto",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  boxShadow: "0 12px 32px #00000080",
  padding: 4,
  boxSizing: "border-box",
};

const giftOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 8px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

const giftEmptyStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#0E0F12",
  border: "1px dashed #2A2C33",
  borderRadius: 8,
  fontSize: 11.5,
  color: "#5B5D66",
  lineHeight: 1.5,
};
