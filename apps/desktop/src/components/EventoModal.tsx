import { matchesQuery } from "../lib/search";
import { useEffect, useState } from "react";
import { GiftPicker } from "./GiftPicker";
import type {
  Accion,
  Evento,
  EventoPorque,
  EventoQuien,
  GiftCatalogEntry,
  GiftCatalogMessage,
} from "@streamtok/shared";
import {
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
  const [porqueSearch, setPorqueSearch] = useState("");
  const [nivelEquipoRequerido, setNivelEquipoRequerido] = useState<number>(
    initial?.nivelEquipoRequerido ?? 0,
  );
  const [nivelPuntosRequerido, setNivelPuntosRequerido] = useState<number>(
    initial?.nivelPuntosRequerido ?? 0,
  );
  const [nivelMinimo, setNivelMinimo] = useState<number>(initial?.nivelMinimo ?? 1);
  const [comando, setComando] = useState(initial?.comando ?? "");
  const [cantidadMinimaLikes, setCantidadMinimaLikes] = useState<number>(
    initial?.cantidadMinimaLikes ?? 15,
  );
  const [valorMinimoMonedas, setValorMinimoMonedas] = useState<number>(
    initial?.valorMinimoMonedas ?? 1,
  );
  const [giftName, setGiftName] = useState(initial?.giftName ?? "");
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogEntry[]>([]);
  const [emoteId, setEmoteId] = useState(initial?.emoteId ?? "");
  const [stickerId, setStickerId] = useState(initial?.stickerId ?? "");
  const [nombreProductoContiene, setNombreProductoContiene] = useState(
    initial?.nombreProductoContiene ?? "",
  );
  const [accionesTodas, setAccionesTodas] = useState<string[]>(initial?.accionesTodas ?? []);
  const [accionesAleatorias, setAccionesAleatorias] = useState<string[]>(
    initial?.accionesAleatorias ?? [],
  );
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

  function addAccionTodas(id: string) {
    setAccionesTodas((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeAccionTodas(id: string) {
    setAccionesTodas((prev) => prev.filter((x) => x !== id));
  }

  function addAccionAleatoria(id: string) {
    setAccionesAleatorias((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeAccionAleatoria(id: string) {
    setAccionesAleatorias((prev) => prev.filter((x) => x !== id));
  }

  function submit() {
    setError(null);

    if (accionesTodas.length === 0 && accionesAleatorias.length === 0) {
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
    if (porque === "regaloEspecifico" && !giftName) {
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

    const selectedGift = giftCatalog.find((g) => g.name === giftName);

    const evento: Evento = {
      id: initial?.id ?? newId(),
      activo: initial?.activo ?? true,
      quien,
      porque,
      accionesTodas,
      accionesAleatorias,
      usuarioEspecifico: quien === "usuarioEspecifico" ? usuarioEspecifico.trim() : undefined,
      numeroDonantesTop: quien === "donanteTop" ? numOr(numeroDonantesTop, 3) : undefined,
      nivelEquipoRequerido:
        porque === "unirse" || porque === "primeraActividad" || porque === "comando"
          ? numOr(nivelEquipoRequerido, 0)
          : undefined,
      nivelPuntosRequerido: porque === "comando" ? numOr(nivelPuntosRequerido, 0) : undefined,
      nivelMinimo:
        porque === "subeNivelFan" || porque === "subeNivelDonador"
          ? Math.max(1, Math.floor(numOr(nivelMinimo, 1)))
          : undefined,
      comando: porque === "comando" ? comando.trim() : undefined,
      cantidadMinimaLikes: porque === "likes" ? numOr(cantidadMinimaLikes, 15) : undefined,
      valorMinimoMonedas: porque === "regaloValorMinimo" ? numOr(valorMinimoMonedas, 1) : undefined,
      giftId: porque === "regaloEspecifico" ? selectedGift?.id : undefined,
      giftName: porque === "regaloEspecifico" ? giftName : undefined,
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
    porque === "compraTiktokShop" ||
    porque === "subeNivelFan" ||
    porque === "subeNivelDonador";

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
            <input
              value={porqueSearch}
              placeholder="Buscar…"
              onChange={(e) => setPorqueSearch(e.target.value)}
              style={{ ...comboSearchStyle, margin: "0 0 8px" }}
            />
            <div style={radioListStyle}>
              {PORQUE_OPTIONS.filter(
                (o) => o.value === porque || matchesQuery(o.label, porqueSearch),
              ).map((o) => (
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
                    <GiftPicker value={giftName} gifts={giftCatalog} onSelect={setGiftName} />
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

              {(porque === "subeNivelFan" || porque === "subeNivelDonador") && (
                <label style={labelStyle}>
                  {porque === "subeNivelFan" ? "Nivel de fan mínimo" : "Nivel de donador mínimo"}
                  <input
                    type="number"
                    style={inputStyle}
                    value={Number.isFinite(nivelMinimo) ? nivelMinimo : ""}
                    min={1}
                    onChange={(e) => setNivelMinimo(e.target.value === "" ? NaN : Number(e.target.value))}
                  />
                  <span style={noteStyle}>
                    Se dispara cuando el usuario sube a este nivel o más. Con 1 se dispara en cualquier
                    subida. La primera vez que se ve a un usuario no cuenta como subida.
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

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>
                Desencadenar todas estas acciones
              </label>
              <AccionCombo
                selected={accionesTodas}
                acciones={acciones}
                onAdd={addAccionTodas}
                onRemove={removeAccionTodas}
                emptyText="Agrega las acciones que se ejecutarán todas."
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, color: "#9A9CA5" }}>
                Desencadenar una de estas acciones (aleatoriamente)
              </label>
              <AccionCombo
                selected={accionesAleatorias}
                acciones={acciones}
                onAdd={addAccionAleatoria}
                onRemove={removeAccionAleatoria}
                emptyText="Agrega las acciones entre las que se elegirá una al azar."
              />
            </div>
          </div>

          {acciones.length === 0 && (
            <div style={noteStyle}>No hay Acciones creadas todavía. Crea una Acción primero.</div>
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

function AccionCombo({
  selected,
  acciones,
  onAdd,
  onRemove,
  emptyText,
}: {
  selected: string[];
  acciones: Accion[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = acciones.filter((a) => !selected.includes(a.id));
  const visible = available.filter((a) => matchesQuery(a.nombre, query));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={chipsBoxStyle}>
        {selected.length === 0 ? (
          <span style={{ color: "#5B5D66", fontSize: 12.5 }}>{emptyText}</span>
        ) : (
          selected.map((id) => {
            const a = acciones.find((x) => x.id === id);
            return (
              <span key={id} style={chipStyle}>
                {a?.nombre ?? id}
                <button type="button" onClick={() => onRemove(id)} style={chipRemoveStyle}>
                  ✕
                </button>
              </span>
            );
          })
        )}
      </div>

      <div style={{ position: "relative" }}>
        <button type="button" onClick={() => {
            setQuery("");
            setOpen((o) => !o);
          }}
          style={accionComboButtonStyle}
        >
          <span style={{ flex: 1, textAlign: "left", fontSize: 12.5 }}>+ Agregar acción</span>
          <span style={{ fontSize: 11, color: "#5B5D66" }}>▾</span>
        </button>
        {open && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 15 }} onClick={() => setOpen(false)} />
            <div style={accionComboDropdownStyle}>
              <input
                autoFocus
                value={query}
                placeholder="Buscar…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "Enter" && visible[0]) {
                    onAdd(visible[0].id);
                    setOpen(false);
                  }
                }}
                style={comboSearchStyle}
              />
              {available.length === 0 ? (
                <span style={{ padding: "8px 10px", fontSize: 12, color: "#5B5D66" }}>
                  No hay más acciones para agregar.
                </span>
              ) : visible.length === 0 ? (
                <span style={{ padding: "8px 10px", fontSize: 12, color: "#5B5D66" }}>Sin resultados</span>
              ) : (
                visible.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onAdd(a.id);
                      setOpen(false);
                    }}
                    style={accionComboOptionStyle}
                  >
                    {a.nombre}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
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

const accionComboButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  background: "#0E0F12",
  border: "1px solid #2A2C33",
  borderRadius: 7,
  cursor: "pointer",
  color: "#F4F4F5",
  boxSizing: "border-box",
};

const accionComboDropdownStyle: React.CSSProperties = {
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

const accionComboOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "7px 8px",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  color: "#C4C5CC",
  fontSize: 12.5,
  background: "none",
};

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

const giftEmptyStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#0E0F12",
  border: "1px dashed #2A2C33",
  borderRadius: 8,
  fontSize: 11.5,
  color: "#5B5D66",
  lineHeight: 1.5,
};

const comboSearchStyle: React.CSSProperties = {
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 6,
  color: "#F4F4F5",
  fontSize: 12,
  padding: "6px 8px",
  margin: "0 0 4px",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
};
