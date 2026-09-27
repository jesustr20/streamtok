import { useEffect, useState } from "react";
import type {
  MappingRule,
  MappingRulesMessage,
  ModHelloPayload,
} from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { EVENT_LABELS, RuleWizard } from "./RuleWizard";

type WizardState = { mode: "create" } | { mode: "edit"; rule: MappingRule } | null;

export function MappingRulesPanel({
  client,
  catalog,
}: {
  client: SidecarClient | null;
  catalog: ModHelloPayload | null;
}) {
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardState>(null);

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

  function saveRule(rule: MappingRule) {
    const exists = rules.some((r) => r.id === rule.id);
    const next = exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
    client?.send("mapping-rules", { kind: "set", rules: next });
    setWizard(null);
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
                <button onClick={() => setWizard({ mode: "edit", rule })} style={linkButtonStyle}>
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

      {wizard ? (
        <RuleWizard
          catalog={catalog}
          initial={wizard.mode === "edit" ? wizard.rule : null}
          onSubmit={saveRule}
          onCancel={() => setWizard(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setWizard({ mode: "create" })}
          style={{ ...primaryButtonStyle, alignSelf: "flex-start" }}
        >
          Nueva regla
        </button>
      )}
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
