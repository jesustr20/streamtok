import { useState } from "react";
import type { MappingRule, ModAction, ModHelloPayload } from "@streamtok/shared";
import { ParamEditor, sanitizeParamValues, type ParamValues } from "./ParamEditor";

export const EVENT_OPTIONS: MappingRule["when"]["event"][] = [
  "gift",
  "like",
  "comment",
  "follow",
  "share",
  "join",
  "subscribe",
];

export const EVENT_LABELS: Record<MappingRule["when"]["event"], string> = {
  gift: "Regalo",
  like: "Like",
  comment: "Comentario",
  follow: "Follow",
  share: "Compartir",
  join: "Entra al live",
  subscribe: "Suscripción",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#9A9CA5",
};

const hintStyle: React.CSSProperties = { fontSize: 11.5, color: "#5B5D66", lineHeight: 1.4 };

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#E23A57",
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#C4C5CC",
  fontSize: 13,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2A2C33",
  border: "none",
  borderRadius: 8,
  color: "#5B5D66",
  fontSize: 13,
  fontWeight: 700,
  cursor: "default",
};

/**
 * Wizard de 3 pasos para crear/editar una MappingRule sin tocar JSON crudo:
 *   1. Evento disparador (regalo con giftId/minCoins, comentario con comando,
 *      o cualquier otro evento sin trigger).
 *   2. Acción del mod (búsqueda sobre el catálogo del mod-hello).
 *   3. Parámetros de la acción (reusa ParamEditor) + passCoinsAsParam opcional.
 */
export function RuleWizard({
  catalog,
  initial,
  onSubmit,
  onCancel,
}: {
  catalog: ModHelloPayload | null;
  initial?: MappingRule | null;
  onSubmit: (rule: MappingRule) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [event, setEvent] = useState<MappingRule["when"]["event"]>(initial?.when.event ?? "gift");
  const [command, setCommand] = useState(initial?.when.command ?? "");
  const [giftId, setGiftId] = useState(
    initial?.when.giftId !== undefined ? String(initial.when.giftId) : "",
  );
  const [minCoins, setMinCoins] = useState(
    initial?.when.minCoins !== undefined ? String(initial.when.minCoins) : "",
  );
  const [actionId, setActionId] = useState(initial?.action ?? "");
  const [actionQuery, setActionQuery] = useState("");
  const [params, setParams] = useState<ParamValues>(initial?.params ?? {});
  const [passCoinsAsParam, setPassCoinsAsParam] = useState(initial?.passCoinsAsParam ?? "");

  const actions = catalog?.actions ?? [];
  const q = actionQuery.trim().toLowerCase();
  const filteredActions = actions.filter((a) => {
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q)
    );
  });
  const selectedAction: ModAction | null = actions.find((a) => a.id === actionId) ?? null;

  function selectAction(id: string) {
    if (id === actionId) return;
    setActionId(id);
    setParams({}); // los params son por-acción; resetear al cambiar de acción
  }

  function buildRule(): MappingRule {
    const when: MappingRule["when"] = { event };
    if (event === "comment" && command.trim()) when.command = command.trim();
    if (event === "gift") {
      if (giftId.trim()) when.giftId = Number(giftId);
      if (minCoins.trim()) when.minCoins = Number(minCoins);
    }
    const rule: MappingRule = {
      id: initial?.id ?? crypto.randomUUID(),
      when,
      action: actionId,
      params: sanitizeParamValues(params),
    };
    if (passCoinsAsParam.trim()) rule.passCoinsAsParam = passCoinsAsParam.trim();
    return rule;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 14,
        background: "#14151A",
        border: "1px solid #2A2C33",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {initial ? "Editar regla" : "Nueva regla"}
        </div>
        <div style={{ fontSize: 11, color: "#5B5D66" }}>Paso {step} de 3</div>
      </div>

      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={labelStyle}>
            Evento disparador
            <select
              style={inputStyle}
              value={event}
              onChange={(e) => setEvent(e.target.value as MappingRule["when"]["event"])}
            >
              {EVENT_OPTIONS.map((ev) => (
                <option key={ev} value={ev}>
                  {EVENT_LABELS[ev]}
                </option>
              ))}
            </select>
          </label>

          {event === "gift" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Gift ID
                  <input
                    style={inputStyle}
                    value={giftId}
                    placeholder="5655"
                    onChange={(e) => setGiftId(e.target.value)}
                  />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Ignorar regalos debajo de (coins)
                  <input
                    style={inputStyle}
                    type="number"
                    value={minCoins}
                    placeholder="opcional"
                    onChange={(e) => setMinCoins(e.target.value)}
                  />
                </label>
              </div>
              <div style={hintStyle}>
                El gift ID es el identificador numérico del regalo en TikTok (dejalo vacío para
                reaccionar a cualquier regalo). "Ignorar debajo de" deja pasar solo regalos cuyo
                valor total en coins sea mayor o igual al indicado.
              </div>
            </div>
          )}

          {event === "comment" && (
            <label style={labelStyle}>
              Comando (ej. !carro)
              <input
                style={inputStyle}
                value={command}
                placeholder="!carro"
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
          )}

          {event !== "gift" && event !== "comment" && (
            <div style={hintStyle}>
              Esta regla reaccionará a todo evento de tipo "{EVENT_LABELS[event].toLowerCase()}"
              (sin condición adicional).
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actions.length === 0 ? (
            <div style={hintStyle}>
              El mod no está conectado o no publicó acciones todavía (mod-hello). Conectá el mod
              para elegir una acción.
            </div>
          ) : (
            <>
              <input
                style={inputStyle}
                value={actionQuery}
                placeholder="Buscar acción por nombre, id o categoría…"
                onChange={(e) => setActionQuery(e.target.value)}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                {filteredActions.map((a) => {
                  const selected = a.id === actionId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => selectAction(a.id)}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        background: selected ? "#1F222B" : "#17181D",
                        border: `1px solid ${selected ? "#5B7CFA" : "#2A2C33"}`,
                        borderRadius: 8,
                        color: "#F4F4F5",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{a.name}</span>
                        <span style={{ fontSize: 10, color: "#5B7CFA" }}>{a.category}</span>
                      </span>
                      <span style={{ fontSize: 11, color: "#9A9CA5" }}>{a.id}</span>
                      <span style={{ fontSize: 11, color: "#5B5D66" }}>{a.description}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={hintStyle}>
            Configurando <b>{selectedAction?.name ?? actionId}</b>
            {selectedAction ? ` (${selectedAction.id})` : ""}.
          </div>
          {selectedAction ? (
            <ParamEditor
              key={actionId}
              params={selectedAction.params}
              initialValues={params}
              onChange={setParams}
            />
          ) : (
            <div style={hintStyle}>Elegí una acción antes de configurar parámetros.</div>
          )}
          <label style={labelStyle}>
            Pasar coins a este param (opcional)
            <input
              style={inputStyle}
              value={passCoinsAsParam}
              placeholder="ej. coins"
              onChange={(e) => setPassCoinsAsParam(e.target.value)}
            />
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
          Cancelar
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((step - 1) as 1 | 2 | 3)}
              style={secondaryButtonStyle}
            >
              Atrás
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((step + 1) as 1 | 2 | 3)}
              disabled={step === 2 && !actionId}
              style={step === 2 && !actionId ? disabledButtonStyle : primaryButtonStyle}
            >
              Siguiente
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSubmit(buildRule())}
              disabled={!actionId}
              style={!actionId ? disabledButtonStyle : primaryButtonStyle}
            >
              Guardar regla
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
