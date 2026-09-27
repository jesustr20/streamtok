import {
  ManualCommandRequestSchema,
  type ManualCommandResponse,
} from "@streamtok/shared";
import type { ModBridge } from "./mod-bridge.js";
import type { StreamTokWsServer } from "./ws-server.js";

/**
 * Canal `manual-command` (UI → sidecar): dispara un mod-command puntual
 * reusando `ModBridge.sendCommand` (el mismo camino que usa el motor de
 * mapeo). No toca el protocolo del mod: el request es un concepto UI↔sidecar
 * y la respuesta es un `ManualCommandResponse` en el mismo canal.
 */

function formatZodError(err: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  const issues = err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "raíz"}: ${i.message}`);
  return `manual-command inválido: ${issues.join("; ")}`;
}

export function registerManualCommand(
  server: StreamTokWsServer,
  modBridge: ModBridge,
): () => void {
  return server.onChannel("manual-command", (payload, socket) => {
    const parsed = ManualCommandRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const response: ManualCommandResponse = {
        kind: "error",
        message: formatZodError(parsed.error),
      };
      server.sendTo(socket, "manual-command", response);
      return;
    }

    const { action, params, nameTag } = parsed.data;
    modBridge
      .sendCommand(action, params, nameTag ? { nameTag } : {})
      .then((ack) => {
        const response: ManualCommandResponse = { kind: "ack", ack };
        server.sendTo(socket, "manual-command", response);
      })
      .catch((err) => {
        const response: ManualCommandResponse = {
          kind: "error",
          message: `Error enviando el comando: ${(err as Error).message ?? err}`,
        };
        server.sendTo(socket, "manual-command", response);
      });
  });
}
