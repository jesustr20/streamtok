import type { AgentConfig } from "@streamtok/shared";
import { Card, Field, NumberField } from "./overlays-ui";

/**
 * «Conversación natural» (ADR 0024, §5): el agente atiende charla del chat sin comando, pero solo si lo nombran o si
 * quien habla acaba de recibir su respuesta. Un filtro local decide antes de llamar al modelo; apagada por defecto.
 */
export function AgenteConversacion({ config, patch }: { config: AgentConfig; patch: (p: Partial<AgentConfig>) => void }) {
  const c = config.conversation;
  const set = (p: Partial<AgentConfig["conversation"]>) => patch({ conversation: { ...c, ...p } });
  return (
    <Card title="Conversación natural">
      <div style={{ fontSize: 12.5, color: "#C9CBD2", lineHeight: 1.55 }}>
        Además de las preguntas con <b>{config.command}</b>, el agente puede contestar charla del chat: solo si alguien dice «{config.name}» o si escribe justo después de que le respondió.
        Cumple las mismas reglas de quién puede preguntar, va después de las preguntas y de los regalos, y cada respuesta gasta una llamada del modelo.
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Activar la conversación natural
      </label>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", opacity: c.enabled ? 1 : 0.55 }}>
        <div style={{ width: 150 }}>
          <Field label="Máx. por minuto" hint="intervenciones">
            <NumberField value={c.perMinute} min={1} integer onCommit={(v) => set({ perMinute: Math.min(20, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 170 }}>
          <Field label="Espera por viewer (s)" hint="entre una charla y otra">
            <NumberField value={c.viewerCooldownSec} min={10} integer onCommit={(v) => set({ viewerCooldownSec: Math.min(600, Math.max(10, Math.round(v))) })} />
          </Field>
        </div>
        <div style={{ width: 150 }}>
          <Field label="Máx. por LIVE" hint="protege tu saldo">
            <NumberField value={c.maxCalls} min={1} integer onCommit={(v) => set({ maxCalls: Math.min(2000, Math.max(1, Math.round(v))) })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}
