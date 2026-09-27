import { useEffect, useState } from "react";
import type {
  CommunityRule,
  CommunityRuleKind,
  CommunityRules,
  CommunityRulesMessage,
  ModHelloPayload,
} from "@streamtok/shared";
import { COMMUNITY_RULE_KINDS, defaultCommunityRules } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { ParamEditor, sanitizeParamValues, type ParamValues } from "./ParamEditor";

const COMMUNITY_LABELS: Record<CommunityRuleKind, string> = {
  follow: "Seguir",
  share: "Compartir",
  superfan: "SuperFan",
  like: "Likes",
};

const COMMUNITY_HINTS: Record<CommunityRuleKind, string> = {
  follow: "Se dispara cuando alguien sigue el live.",
  share: "Se dispara cuando alguien comparte el live.",
  superfan: "Se dispara cuando alguien se suscribe (SuperFan).",
  like: "Se dispara cada N likes.",
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

/**
 * Panel "Reglas de Comunidad" (ADR 0003): 4 filas fijas (Seguir/Compartir/
 * SuperFan/Likes) que siempre existen y solo se configuran. Cada fila tiene un
 * toggle, una acción del catálogo con sus params (ParamEditor) y, solo en
 * Likes, el umbral "cada N likes". Todo opera sobre el perfil activo.
 */
export function CommunityRulesPanel({
  client,
  catalog,
}: {
  client: SidecarClient | null;
  catalog: ModHelloPayload | null;
}) {
  const [rules, setRules] = useState<CommunityRules>(() => defaultCommunityRules());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    const off = client.on((evt) => {
      if (evt.channel !== "community-rules") return;
      const msg = evt.payload as CommunityRulesMessage;
      if (msg.kind === "update") {
        setRules(msg.rules);
        setError(null);
      } else if (msg.kind === "error") {
        setError(msg.message);
      }
    });
    return off;
  }, [client]);

  function commit(next: CommunityRules) {
    setRules(next);
    client?.send("community-rules", { kind: "set", rules: next });
  }

  function patch(kind: CommunityRuleKind, partial: Partial<CommunityRule>) {
    commit({ ...rules, [kind]: { ...rules[kind], ...partial } });
  }

  function selectAction(kind: CommunityRuleKind, actionId: string) {
    patch(kind, { action: actionId, params: {} });
  }

  function selectParams(kind: CommunityRuleKind, params: ParamValues) {
    patch(kind, { params: sanitizeParamValues(params) });
  }

  function toggleEnabled(kind: CommunityRuleKind, enabled: boolean) {
    patch(kind, { enabled });
  }

  function setEveryNLikes(value: number) {
    patch("like", { everyNLikes: value });
  }

  const actions = catalog?.actions ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {COMMUNITY_RULE_KINDS.map((kind) => {
        const slot = rules[kind];
        const selectedAction = actions.find((a) => a.id === slot.action) ?? null;
        return (
          <div
            key={kind}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              background: "#17181D",
              border: "1px solid #2A2C33",
              borderRadius: 9,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <input
                  type="checkbox"
                  checked={slot.enabled}
                  onChange={(e) => toggleEnabled(kind, e.target.checked)}
                />
                {COMMUNITY_LABELS[kind]}
              </label>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#5B5D66" }}>
                {COMMUNITY_HINTS[kind]}
              </span>
            </div>

            {slot.enabled && (
              <>
                <label style={labelStyle}>
                  Acción
                  <select
                    style={inputStyle}
                    value={slot.action}
                    onChange={(e) => selectAction(kind, e.target.value)}
                  >
                    <option value="">Sin acción</option>
                    {actions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.id})
                      </option>
                    ))}
                  </select>
                </label>

                {selectedAction && selectedAction.params.length > 0 && (
                  <ParamEditor
                    key={selectedAction.id}
                    params={selectedAction.params}
                    initialValues={slot.params}
                    onChange={(values) => selectParams(kind, values)}
                  />
                )}

                {kind === "like" && (
                  <label style={{ ...labelStyle, maxWidth: 180 }}>
                    Cada N likes
                    <input
                      style={inputStyle}
                      type="number"
                      min={1}
                      step={1}
                      value={slot.everyNLikes ?? 1}
                      onChange={(e) => setEveryNLikes(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </label>
                )}
              </>
            )}

            {slot.enabled && actions.length === 0 && (
              <div style={hintStyle}>
                El mod no está conectado o no publicó acciones todavía (mod-hello).
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div
          style={{
            padding: "8px 10px",
            background: "#2A141A",
            border: "1px solid #E23A57",
            borderRadius: 8,
            color: "#F4A5B4",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
