import { WebSocket } from "ws";

const PORT = 7331;

function connect(name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on("open", () => resolve(ws));
  });
}

async function main() {
  // 1. Cliente que simula el mod de GTA V
  const modWs = await connect("mod");
  modWs.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.channel === "mod-command") {
      console.log("[mod] recibió mod-command:", JSON.stringify(msg.payload));
      // el mod responde con mod-ack
      modWs.send(JSON.stringify({ channel: "mod-ack", payload: { id: msg.payload.id, ok: true } }));
    }
  });

  // manda mod-hello con el catálogo (mínimo, arena_join incluido)
  modWs.send(
    JSON.stringify({
      channel: "mod-hello",
      payload: {
        mod: "gtav-chaos",
        version: "0.9.0",
        actions: [
          {
            id: "arena_join",
            name: "Unirse a la arena",
            category: "arena",
            icon: "arena",
            description: "El viewer entra a la pelea",
            supportsNameTag: true,
            params: [{ name: "character", type: "enum", default: "default", options: ["default"] }],
          },
        ],
      },
    }),
  );

  // 2. Cliente que simula la UI del desktop escuchando mod-catalog / mod-ack-log
  const uiWs = await connect("ui");
  uiWs.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.channel === "mod-catalog") {
      console.log("[ui] mod-catalog recibido, acciones:", msg.payload.actions.length);
    }
    if (msg.channel === "mod-ack-log") {
      console.log("[ui] mod-ack-log recibido:", JSON.stringify(msg.payload));
    }
  });

  await new Promise((r) => setTimeout(r, 500));

  // 3. Simula un regalo Rose (giftId 5655) llegando del LIVE → debe disparar arena_join
  uiWs.send(
    JSON.stringify({
      channel: "live-event",
      payload: {
        event: "gift",
        username: "@fan123",
        nickname: "Fan 123",
        giftId: 5655,
        coins: 1,
        timestamp: Date.now(),
      },
    }),
  );

  await new Promise((r) => setTimeout(r, 1500));
  console.log("smoke test terminado");
  process.exit(0);
}

main();
