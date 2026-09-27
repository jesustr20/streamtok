import { useState } from "react";
import type { ModAction, ModHelloPayload } from "@streamtok/shared";
import { ParamEditor } from "./ParamEditor";

/** Agrupa el catálogo del mod-hello por `category`, tal como pide el punto
 * 2 del contrato ("UI de acciones agrupadas por category"). Cada acción se
 * puede expandir para editar sus parámetros con el editor tipado. */
export function ActionsPanel({ catalog }: { catalog: ModHelloPayload | null }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    setExpandedId((prev) => (prev === id ? null : id));
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
                    }}
                  >
                    <ParamEditor key={action.id} params={action.params} />
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
