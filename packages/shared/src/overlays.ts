import { z } from "zod";
import type { ModAction } from "./mod-protocol.js";

/**
 * Overlays y contadores (ADR 0011). Concepto UI/overlay ↔ sidecar, NO forma
 * parte del protocolo del mod (mod-protocol.ts) ni del LiveEvent (live-event.ts).
 *
 * Dos contadores por ahora: **timer** (cuenta atrás que los espectadores pueden
 * alargar o acortar) y **wins** (meta y conteo, p. ej. "2 / 6").
 */

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

/** Segundos que suma (o resta, si es negativo) cada tipo de interacción. Admite
 * decimales (p. ej. 0.05 por like). 0 = no afecta. */
export const TimerPerTypeSchema = z.object({
  /** por cada moneda de un regalo */
  coin: z.number().default(0),
  /** por cada suscripción / Super Fan */
  subscribe: z.number().default(0),
  follow: z.number().default(0),
  share: z.number().default(0),
  /** por cada like (tap) */
  like: z.number().default(0),
  /** por cada mensaje de chat */
  chat: z.number().default(0),
});
export type TimerPerType = z.infer<typeof TimerPerTypeSchema>;

export const TimerConfigSchema = z.object({
  /** valor inicial por defecto, en segundos (0 = sin valor inicial: arranca con la primera interacción) */
  startSeconds: z.number().nonnegative().default(0),
  /** si está en 0 o detenido, la primera interacción que suma tiempo lo inicia sola */
  autoStart: z.boolean().default(true),
  /** tiempo máximo en segundos; 0 = sin máximo */
  maxSeconds: z.number().nonnegative().default(0),
  /** al cerrar la app con el timer activo, se restaura en pausa al volver */
  rememberOnClose: z.boolean().default(true),
  /** ids de Acciones que se ejecutan cuando el timer llega a 0 */
  onExpireAccionIds: z.array(z.string()).default([]),
  perType: TimerPerTypeSchema.default({}),
  /** título que se muestra sobre el temporizador (p. ej. "EXTENSIBLE"); vacío = sin título */
  title: z.string().max(60).default(""),
  /** muestra bajo el título cuánto suma cada moneda (p. ej. "1 coin = 3 s"); solo aparece si suma o resta */
  showRate: z.boolean().default(true),
  /** si está activo, todos los segundos por tipo se multiplican por `value` */
  multiplier: z
    .object({ active: z.boolean().default(false), value: z.number().positive().default(1.5) })
    .default({}),
});
export type TimerConfig = z.infer<typeof TimerConfigSchema>;

/** Diseño elegido y personalización de un overlay. */
export const OverlayStyleSchema = z.object({
  /** id del diseño (plantilla HTML/CSS) de la lista de ese tipo de overlay */
  designId: z.string(),
  textColor: z.string().optional(),
  accentColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  /** factor de tamaño (1 = normal) */
  scale: z.number().positive().default(1),
});
export type OverlayStyle = z.infer<typeof OverlayStyleSchema>;

export const OverlaysConfigSchema = z.object({
  timer: TimerConfigSchema.default({}),
  timerStyle: OverlayStyleSchema.default({ designId: "interactive" }),
  winsStyle: OverlayStyleSchema.default({ designId: "interactive" }),
});
export type OverlaysConfig = z.infer<typeof OverlaysConfigSchema>;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export const TimerStatusSchema = z.enum(["idle", "running", "paused", "finished"]);
export type TimerStatus = z.infer<typeof TimerStatusSchema>;

/**
 * Estado del timer. Corriendo se guarda la HORA DE FIN (`endsAt`, epoch ms), no
 * los segundos restantes, para que cualquier overlay pueda dibujar la cuenta
 * sola y sobreviva a un reinicio. Fuera de `running`, `remainingMs` manda.
 */
export const TimerStateSchema = z.object({
  status: TimerStatusSchema,
  remainingMs: z.number().nonnegative(),
  endsAt: z.number().optional(),
});
export type TimerState = z.infer<typeof TimerStateSchema>;

export const WinsStateSchema = z.object({
  title: z.string(),
  /** meta: cuántos wins se quiere lograr */
  goal: z.number().int().nonnegative(),
  /** conteo: cuántos van. Puede ser negativo: si alguien "quita" más wins de los que llevas,
   * hay que recuperarlos antes de volver a avanzar hacia la meta. */
  count: z.number().int(),
});
export type WinsState = z.infer<typeof WinsStateSchema>;

export const OverlaysStateSchema = z.object({
  timer: TimerStateSchema,
  wins: WinsStateSchema,
  /** reloj del sidecar al enviar el estado, para que el overlay corrija su desfase */
  serverNow: z.number(),
});
export type OverlaysState = z.infer<typeof OverlaysStateSchema>;

/** Forma en disco de `overlays.json` (configuración + estado de los contadores). */
export const OverlaysFileSchema = z.object({
  config: OverlaysConfigSchema.default({}),
  timer: TimerStateSchema.optional(),
  wins: WinsStateSchema.optional(),
  /** epoch ms del último guardado (para saber cuánto faltaba al cerrar la app) */
  savedAt: z.number().optional(),
});
export type OverlaysFile = z.infer<typeof OverlaysFileSchema>;

// ---------------------------------------------------------------------------
// Canal WS `overlays`
// ---------------------------------------------------------------------------

export const TimerOpSchema = z.enum(["start", "pause", "reset", "stop", "add", "set"]);
export type TimerOp = z.infer<typeof TimerOpSchema>;

export const WinsOpSchema = z.enum(["add", "set", "reset", "set-goal", "set-title"]);
export type WinsOp = z.infer<typeof WinsOpSchema>;

/**
 * Canal WS `overlays`:
 *  - `get-state`      cliente → sidecar: pedir estado y configuración.
 *  - `state`          sidecar → todos: estado + configuración vigentes (broadcast
 *                     en cada cambio, a clientes tardíos y en respuesta a `get-state`).
 *  - `timer-control`  UI → sidecar: iniciar/pausar/reiniciar/detener, sumar o fijar segundos.
 *  - `wins-control`   UI → sidecar: sumar, fijar conteo/meta/título, reiniciar.
 *  - `set-config`     UI → sidecar: configuración completa.
 *  - `error`          sidecar → quien pidió: rechazo.
 * Los overlays solo LEEN (`get-state`/`state`); el control entra por la UI y por Eventos.
 */
export const OverlaysMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({ kind: z.literal("state"), state: OverlaysStateSchema, config: OverlaysConfigSchema }),
  z.object({ kind: z.literal("timer-control"), op: TimerOpSchema, seconds: z.number().optional() }),
  z.object({
    kind: z.literal("wins-control"),
    op: WinsOpSchema,
    value: z.union([z.number(), z.string()]).optional(),
  }),
  z.object({ kind: z.literal("set-config"), config: OverlaysConfigSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type OverlaysMessage = z.infer<typeof OverlaysMessageSchema>;

// ---------------------------------------------------------------------------
// Servidor de overlays y diseños
// ---------------------------------------------------------------------------

/**
 * Tiempo del timer como texto: `MM:SS` y, desde 1 hora, `HH:MM:SS` (01:00:00).
 * Redondea hacia arriba los milisegundos. La página del overlay tiene su propia
 * copia en JavaScript (`FORMAT_TIMER_JS`, overlay-pages.ts); un test las compara.
 */
export function formatTimerMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => (n < 10 ? "0" + n : String(n));
  return h > 0 ? two(h) + ":" + two(m) + ":" + two(sec) : two(m) + ":" + two(sec);
}

/**
 * Texto de equivalencia por moneda que va bajo el título ("1 coin = 3 s"), con el
 * multiplicador ya aplicado (lo que de verdad suma). Vacío si las monedas no
 * afectan al timer. Tiene una copia en JavaScript (`RATE_TEXT_JS`, overlay-pages.ts);
 * un test las compara.
 */
export function timerRateText(t: {
  perType: { coin: number };
  multiplier: { active: boolean; value: number };
}): string {
  const mult = t.multiplier.active ? t.multiplier.value : 1;
  const seconds = Math.round(t.perType.coin * mult * 100) / 100;
  return seconds ? "1 coin = " + String(seconds) + " s" : "";
}

/** Puerto por defecto del servidor HTTP de overlays del sidecar (127.0.0.1). */
export const OVERLAY_DEFAULT_PORT = 7340;

export type OverlayKind = "timer" | "wins";

export interface OverlayDesign {
  id: string;
  name: string;
}

/** Diseños disponibles por tipo de overlay. Cada uno es una plantilla de la misma
 * página (ver `overlay-pages.ts` del sidecar): cambian el dibujo, no los datos. */
export const OVERLAY_DESIGNS: Record<OverlayKind, OverlayDesign[]> = {
  timer: [
    { id: "interactive", name: "Dígitos grandes" },
    { id: "tikfinity", name: "Compacto" },
    { id: "streamtok", name: "StreamTok" },
  ],
  wins: [
    { id: "interactive", name: "Trofeo" },
    { id: "streamtok", name: "StreamTok" },
  ],
};

// ---------------------------------------------------------------------------
// Comandos internos de la app ("acciones internas", ADR 0011)
// ---------------------------------------------------------------------------

/** Un comando de una Acción cuyo `modActionId` empieza así NO va al mod: lo
 * ejecuta el motor de contadores del sidecar. */
export const APP_COMMAND_PREFIX = "app.";

export function isAppCommand(id: string): boolean {
  return id.startsWith(APP_COMMAND_PREFIX);
}

function appCommand(
  id: string,
  name: string,
  icon: string,
  description: string,
  params: ModAction["params"] = [],
): ModAction {
  return { id, name, category: "other", icon, description, supportsNameTag: false, params };
}

/** Catálogo de comandos internos, con la misma forma que las acciones del mod
 * para que el selector de comandos de la UI los trate igual. */
export const APP_COMMANDS: ModAction[] = [
  appCommand("app.timer.add", "Timer: sumar tiempo", "timer", "Suma segundos al timer. Solo cuenta si el timer está corriendo.", [
    { name: "seconds", type: "int", default: 10, min: -86400, max: 86400, presets: [10, 30, 60, 300] },
  ]),
  appCommand("app.timer.remove", "Timer: restar tiempo", "timer", "Resta segundos al timer; si llega a 0, termina.", [
    { name: "seconds", type: "int", default: 10, min: 0, max: 86400, presets: [10, 30, 60, 300] },
  ]),
  appCommand("app.timer.set", "Timer: fijar tiempo", "timer", "Fija el tiempo restante del timer.", [
    { name: "seconds", type: "int", default: 60, min: 0, max: 86400, presets: [30, 60, 300] },
  ]),
  appCommand("app.timer.start", "Timer: iniciar o reanudar", "timer", "Inicia el timer (o lo reanuda si estaba en pausa)."),
  appCommand("app.timer.pause", "Timer: pausar", "timer", "Pausa el timer."),
  appCommand("app.timer.reset", "Timer: reiniciar", "timer", "Vuelve al tiempo inicial, detenido."),
  appCommand("app.timer.stop", "Timer: detener", "timer", "Detiene el timer en 0."),
  appCommand("app.wins.add", "Wins: sumar", "trophy", "Suma wins al conteo.", [
    { name: "amount", type: "int", default: 1, min: -1000, max: 1000, presets: [1, 2, 5] },
  ]),
  appCommand("app.wins.remove", "Wins: quitar", "trophy", "Quita wins del conteo. Puede dejarlo por debajo de 0: esos wins hay que recuperarlos.", [
    { name: "amount", type: "int", default: 1, min: 0, max: 1000, presets: [1, 2, 5] },
  ]),
  appCommand("app.wins.set", "Wins: fijar conteo", "trophy", "Fija el conteo de wins.", [
    { name: "count", type: "int", default: 0, min: -100000, max: 100000 },
  ]),
  appCommand("app.wins.reset", "Wins: reiniciar conteo", "trophy", "Pone el conteo de wins en 0."),
];

/** Agrega los comandos internos a una lista de acciones del mod (sin duplicar). */
export function withAppCommands(actions: ModAction[]): ModAction[] {
  const have = new Set(actions.map((a) => a.id));
  return [...actions, ...APP_COMMANDS.filter((a) => !have.has(a.id))];
}
