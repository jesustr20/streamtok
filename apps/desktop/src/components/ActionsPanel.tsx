import type { ModAction, ModHelloPayload } from "@streamtok/shared";

/** Agrupa el catálogo del mod-hello por `category`, tal como pide el punto
 * 2 del contrato ("UI de acciones agrupadas por category"). */
export function ActionsPanel({ catalog }: { catalog: ModHelloPayload | null }) {
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
                  padding: "10px 14px",
                  background: "#17181D",
                  border: "1px solid #2A2C33",
                  borderRadius: 9,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{action.name}</span>
                  {action.supportsNameTag && (
                    <span style={{ fontSize: 10, color: "#34D399" }}>usa nameTag</span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "#9A9CA5", marginTop: 2 }}>{action.description}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
