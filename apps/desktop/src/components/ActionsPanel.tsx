import { useState } from "react";
import type { ModAckPayload, ModAction, ModHelloPayload } from "@streamtok/shared";
import type { SidecarClient } from "../lib/ws-client";
import { defaultParamValues, ParamEditor, type ParamValues } from "./ParamEditor";

type TestResult = { ack: ModAckPayload } | { error: string } | null;

/** Descarta valores no serializables (p. ej. un int vacío = NaN → null en JSON)
 * para que el request siempre calce con `ManualCommandRequestSchema`. */
function sanitizeParams(values: ParamValues): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Agrupa el catálogo del mod-hello por `category`, tal como pide el punto
 * 2 del contrato ("UI de acciones agrupadas por category"). Cada acción se
 * puede expandir para editar sus parámetros con el editor tipado y probarla
 * con el botón "Probar acción" (canal `manual-command`). */
export function ActionsPanel({
  catalog,
  client,
}: {
  catalog: ModHelloPayload | null;
  client: SidecarClient | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<ParamValues>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult>(null);

  if (!catalog) {
    return (
      <div style={{ padding: 16, color: "#5B5D66", fontSize: 13 }}>
        Esperando catálogo del mod (mod-hello)… asegúrate de que el mod esté
        corriendo y conectado a ws://localhost:7331.
      </div>
    );
  }

  const byCategory = new Map<string, ModAction[]>();
  for (const action of catalog.actions) {
    if (!byCategory.has(action.category)) byCategory.set(action.category, []);
    byCategory.get(action.category)!.push(action);
  }

  function toggle(id: string) {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    setResult(null);
    if (next !== null) {
      const action = catalog!.actions.find((a) => a.id === next);
      setParamValues(action ? defaultParamValues(action.params) : {});
    } else {
      setParamValues({});
    }
  }

  async function testAction(action: ModAction) {
    if (!client) return;
    setSending(true);
    setResult(null);
    try {
      const resp = await client.sendManualCommand({
        action: action.id,
        params: sanitizeParams(paramValues),
      });
      if (resp.kind === "ack") setResult({ ack: resp.ack });
      else setResult({ error: resp.message });
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 13, color: "#9A9CA5" }}>
        {catalog.mod} v{catalog.version} · {catalog.actions.length} acciones
      </div>
      {[...byCategory.entries()].map(([category, actions]) => (
        <div key={category}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#5B7CFA",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {category}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {actions.map((action) => (
              <div
                key={action.id}
                style={{
                  background: "#17181D",
                  border: "1px solid #2A2C33",
                  borderRadius: 9,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(action.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: "10px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{action.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {action.supportsNameTag && (
                        <span style={{ fontSize: 10, color: "#34D399" }}>usa nameTag</span>
                      )}
                      <span style={{ fontSize: 10.5, color: "#5B5D66" }}>
                        {action.params.length > 0
                          ? `${action.params.length} param${action.params.length === 1 ? "" : "s"}`
                          : "sin params"}
                      </span>
                      <span style={{ fontSize: 11, color: "#5B5D66" }}>
                        {expandedId === action.id ? "▴" : "▾"}
                      </span>
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>{action.description}</span>
                </button>

                {expandedId === action.id && (
                  <div
                    style={{
                      padding: "10px 14px 14px",
                      borderTop: "1px solid #2A2C33",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <ParamEditor key={action.id} params={action.params} onChange={setParamValues} />

                    <button
                      type="button"
                      onClick={() => testAction(action)}
                      disabled={sending || !client}
                      style={{
                        alignSelf: "flex-start",
                        padding: "8px 14px",
                        background: sending || !client ? "#2A2C33" : "#E23A57",
                        border: "none",
                        borderRadius: 8,
                        color: sending || !client ? "#5B5D66" : "#fff",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: sending || !client ? "default" : "pointer",
                      }}
                    >
                      {sending ? "Probando…" : "Probar acción"}
                    </button>

                    {result && (
                      <div
                        style={{
                          padding: "8px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          background: "ack" in result && result.ack.ok ? "#0F1F17" : "#2A1416",
                          color: "ack" in result && result.ack.ok ? "#34D399" : "#E5484D",
                        }}
                      >
                        {"ack" in result
                          ? result.ack.ok
                            ? `✓ Comando enviado (${result.ack.id})`
                            : `✕ ${result.ack.id} — ${result.ack.error ?? "sin detalle"}`
                          : `✕ ${result.error}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
