import { useEffect, useState } from "react";
import type {
  MappingRule,
  MappingRulesMessage,
  ModHelloPayload,
} from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";

const EVENT_OPTIONS: MappingRule["when"]["event"][] = [
  "gift",
  "like",
  "comment",
  "follow",
  "share",
  "join",
  "subscribe",
];

const EVENT_LABELS: Record<MappingRule["when"]["event"], string> = {
  gift: "Regalo",
  like: "Like",
  comment: "Comentario",
  follow: "Follow",
  share: "Compartir",
  join: "Entra al live",
  subscribe: "Suscripción",
};

interface Draft {
  event: MappingRule["when"]["event"];
  command: string;
  giftId: string;
  minCoins: string;
  action: string;
  paramsJson: string;
  passCoinsAsParam: string;
}

const EMPTY_DRAFT: Draft = {
  event: "comment",
  command: "",
  giftId: "",
  minCoins: "",
  action: "",
  paramsJson: "{}",
  passCoinsAsParam: "",
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

export function MappingRulesPanel({
  client,
  catalog,
}: {
  client: SidecarClient | null;
  catalog: ModHelloPayload | null;
}) {
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "mapping-rules") return;
      const msg = evt.payload as MappingRulesMessage;
      if (msg.kind === "update") {
        setRules(msg.rules);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    return off;
  }, [client]);

  function actionName(id: string): string {
    return catalog?.actions.find((a) => a.id === id)?.name ?? id;
  }

  function describeRule(rule: MappingRule): string {
    const when =
      rule.when.event === "comment"
        ? `comentario "${rule.when.command ?? ""}"`
        : rule.when.event === "gift"
          ? `regalo #${rule.when.giftId ?? "*"}` +
            (rule.when.minCoins !== undefined ? ` ≥${rule.when.minCoins} coins` : "")
          : EVENT_LABELS[rule.when.event].toLowerCase();
    return `${when} → ${actionName(rule.action)}`;
  }

  function buildRule(): MappingRule | null {
    let params: Record<string, number | string | boolean>;
    try {
      const parsed: unknown = JSON.parse(draft.paramsJson || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError("Los params deben ser un objeto JSON, p. ej. {\"amount\": 1}");
        return null;
      }
      params = parsed as Record<string, number | string | boolean>;
    } catch {
      setError("Los params no son JSON válido.");
      return null;
    }

    const when: MappingRule["when"] = { event: draft.event };
    if (draft.event === "comment" && draft.command.trim()) when.command = draft.command.trim();
    if (draft.event === "gift") {
      if (draft.giftId.trim()) when.giftId = Number(draft.giftId);
      if (draft.minCoins.trim()) when.minCoins = Number(draft.minCoins);
    }

    const rule: MappingRule = {
      id: editingId ?? crypto.randomUUID(),
      when,
      action: draft.action,
      params,
    };
    if (draft.passCoinsAsParam.trim()) rule.passCoinsAsParam = draft.passCoinsAsParam.trim();
    return rule;
  }

  function submit() {
    if (!draft.action) {
      setError("Elegí una acción del mod.");
      return;
    }
    const rule = buildRule();
    if (!rule) return;

    const next = editingId
      ? rules.map((r) => (r.id === editingId ? rule : r))
      : [...rules, rule];
    client?.send("mapping-rules", { kind: "set", rules: next });
    resetForm();
  }

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
  }

  function startEdit(rule: MappingRule) {
    setEditingId(rule.id);
    setDraft({
      event: rule.when.event,
      command: rule.when.command ?? "",
      giftId: rule.when.giftId !== undefined ? String(rule.when.giftId) : "",
      minCoins: rule.when.minCoins !== undefined ? String(rule.when.minCoins) : "",
      action: rule.action,
      paramsJson: JSON.stringify(rule.params, null, 2),
      passCoinsAsParam: rule.passCoinsAsParam ?? "",
    });
    setError(null);
  }

  function remove(rule: MappingRule) {
    client?.send("mapping-rules", { kind: "set", rules: rules.filter((r) => r.id !== rule.id) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {rules.length === 0 ? (
        <div style={{ padding: 12, color: "#5B5D66", fontSize: 12.5 }}>
          Sin reglas todavía. Creá una para mapear un evento de TikTok a una acción del mod.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "#17181D",
                border: "1px solid #2A2C33",
                borderRadius: 9,
              }}
            >
              <span style={{ fontSize: 13 }}>{describeRule(rule)}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button onClick={() => startEdit(rule)} style={linkButtonStyle}>
                  Editar
                </button>
                <button onClick={() => remove(rule)} style={{ ...linkButtonStyle, color: "#E23A57" }}>
                  Eliminar
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: "8px 10px", background: "#2A141A", border: "1px solid #E23A57", borderRadius: 8, color: "#F4A5B4", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 14,
          background: "#14151A",
          border: "1px solid #2A2C33",
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          {editingId ? "Editar regla" : "Nueva regla"}
        </div>

        <label style={labelStyle}>
          Evento
          <select
            style={inputStyle}
            value={draft.event}
            onChange={(e) => setDraft({ ...draft, event: e.target.value as MappingRule["when"]["event"] })}
          >
            {EVENT_OPTIONS.map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_LABELS[ev]}
              </option>
            ))}
          </select>
        </label>

        {draft.event === "comment" && (
          <label style={labelStyle}>
            Comando (ej. !carro)
            <input
              style={inputStyle}
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            />
          </label>
        )}

        {draft.event === "gift" && (
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ ...labelStyle, flex: 1 }}>
              Gift ID
              <input
                style={inputStyle}
                value={draft.giftId}
                placeholder="5655"
                onChange={(e) => setDraft({ ...draft, giftId: e.target.value })}
              />
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>
              Mín. coins
              <input
                style={inputStyle}
                value={draft.minCoins}
                placeholder="opcional"
                onChange={(e) => setDraft({ ...draft, minCoins: e.target.value })}
              />
            </label>
          </div>
        )}

        <label style={labelStyle}>
          Acción del mod
          <select
            style={inputStyle}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">— elegir —</option>
            {(catalog?.actions ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Params (JSON)
          <textarea
            style={{ ...inputStyle, fontFamily: "monospace", minHeight: 72 }}
            value={draft.paramsJson}
            onChange={(e) => setDraft({ ...draft, paramsJson: e.target.value })}
          />
        </label>

        <label style={labelStyle}>
          Pasar coins a este param (opcional)
          <input
            style={inputStyle}
            value={draft.passCoinsAsParam}
            placeholder="ej. coins"
            onChange={(e) => setDraft({ ...draft, passCoinsAsParam: e.target.value })}
          />
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          {editingId && (
            <button onClick={resetForm} style={secondaryButtonStyle}>
              Cancelar
            </button>
          )}
          <button onClick={submit} style={primaryButtonStyle}>
            {editingId ? "Guardar cambios" : "Agregar regla"}
          </button>
        </div>
      </div>
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#5B7CFA",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

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
