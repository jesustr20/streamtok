import { useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Aviso de "cambios sin guardar" para ventanas y formularios de edición.
 *
 * Se le pasa una "foto" (objeto serializable) de todo lo que el usuario puede editar.
 * La foto del primer render es la de referencia: si al cerrar la actual es distinta,
 * en vez de cerrar se pregunta: Guardar, Salir sin guardar o Cancelar (seguir editando).
 * Si no hubo cambios, cierra directo sin preguntar.
 */
export function useUnsavedGuard(
  snapshot: unknown,
  onClose: () => void,
  save: () => void,
): { requestClose: () => void; dialog: ReactNode; dirty: boolean } {
  const initial = useRef<string | null>(null);
  const current = JSON.stringify(snapshot);
  if (initial.current === null) initial.current = current;
  const dirty = current !== initial.current;
  const [asking, setAsking] = useState(false);

  const requestClose = () => (dirty ? setAsking(true) : onClose());

  const dialog = asking ? (
    <UnsavedChangesDialog
      onKeepEditing={() => setAsking(false)}
      onDiscard={() => {
        setAsking(false);
        onClose();
      }}
      onSave={() => {
        // Si el guardado no pasa la validación, el formulario queda abierto mostrando su error.
        setAsking(false);
        save();
      }}
    />
  ) : null;

  return { requestClose, dialog, dirty };
}

export function UnsavedChangesDialog({
  onKeepEditing,
  onDiscard,
  onSave,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div style={backdropStyle} role="alertdialog" aria-modal="true" aria-label="Cambios sin guardar">
      <div style={cardStyle}>
        <h3 style={{ margin: 0, fontSize: 16, fontFamily: "'Space Grotesk', sans-serif" }}>Tienes cambios sin guardar</h3>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "#9A9CA5" }}>
          Si sales ahora, se perderán los cambios de esta ventana. Elige <b style={{ color: "#C4C5CC" }}>Cancelar</b> para
          seguir editando.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" onClick={onKeepEditing} style={ghostStyle} autoFocus>
            Cancelar
          </button>
          <button type="button" onClick={onDiscard} style={dangerStyle}>
            Salir sin guardar
          </button>
          <button type="button" onClick={onSave} style={primaryStyle}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(14, 15, 18, 0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 400,
  padding: 24,
};

const cardStyle: CSSProperties = {
  width: 420,
  maxWidth: "100%",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 14,
  padding: 22,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 20px 60px #00000099",
  boxSizing: "border-box",
  color: "#F4F4F5",
};

const buttonBase: CSSProperties = {
  height: 36,
  padding: "0 16px",
  borderRadius: 9,
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostStyle: CSSProperties = { ...buttonBase, background: "#0E0F12", border: "1px solid #2A2C33", color: "#F4F4F5" };
const dangerStyle: CSSProperties = { ...buttonBase, background: "transparent", border: "1px solid #B3261E", color: "#F2776F" };
const primaryStyle: CSSProperties = { ...buttonBase, background: "#E23A57", border: "1px solid #E23A57", color: "#fff" };
