import { z } from "zod";
import { OverlayStyleSchema } from "./overlays.js";

/**
 * Agente IA (ADR 0016), fase (a) pieza 1: la cola de preguntas con prioridad y el overlay. Concepto
 * UI/overlay ↔ sidecar; NO es parte del protocolo del mod ni del LiveEvent: el sidecar lee los
 * eventos que ya existen (comentarios, regalos, seguir, compartir).
 *
 * Los espectadores preguntan con un comando del chat (`!ia pregunta`). Quien manda un regalo gana
 * prioridad (más monedas, antes); el resto espera su turno gratis (una cada N segundos, al azar).
 * Solo pregunta quien cumple lo que el streamer marque (seguir, compartir, Fan Club, regalo).
 */

export const AgentEligibilitySchema = z.object({
  /** quien sigue el canal */
  follow: z.boolean().default(true),
  /** quien compartió el LIVE en esta sesión */
  share: z.boolean().default(true),
  /** quien es del Fan Club ("Quiéreme") */
  fanClub: z.boolean().default(true),
  /** quien mandó un regalo (da prioridad según las monedas) */
  gift: z.boolean().default(true),
});
export type AgentEligibility = z.infer<typeof AgentEligibilitySchema>;


// ---------------------------------------------------------------------------
// Proveedores de modelo
// ---------------------------------------------------------------------------

export const AgentProviderIdSchema = z.enum(["deepseek", "openai", "gemini", "claude"]);
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;

export interface AgentProviderInfo {
  id: AgentProviderId;
  name: string;
  /** `openai` = API compatible con la de OpenAI (/chat/completions); `anthropic` = API de mensajes de Claude */
  api: "openai" | "anthropic";
  baseUrl: string;
  defaultModel: string;
  /** dónde se saca la clave (se muestra en la pantalla) */
  keyUrl: string;
}

export const AGENT_PROVIDERS: AgentProviderInfo[] = [
  { id: "deepseek", name: "DeepSeek", api: "openai", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", keyUrl: "platform.deepseek.com" },
  { id: "openai", name: "OpenAI", api: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", keyUrl: "platform.openai.com" },
  { id: "gemini", name: "Gemini", api: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash", keyUrl: "aistudio.google.com" },
  { id: "claude", name: "Claude", api: "anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-haiku-4-5-20251001", keyUrl: "console.anthropic.com" },
];

export function providerInfo(id: AgentProviderId): AgentProviderInfo {
  return AGENT_PROVIDERS.find((p) => p.id === id) ?? AGENT_PROVIDERS[0];
}

/** Qué claves hay guardadas (solo si hay o no; la clave nunca sale del sidecar). */
export type AgentKeyStatus = Record<AgentProviderId, boolean>;

// ---------------------------------------------------------------------------
// Voz (fase c, pieza 1: voces del sistema)
// ---------------------------------------------------------------------------

export const AgentVoiceSchema = z.object({
  /** el overlay lee la respuesta en voz alta */
  enabled: z.boolean().default(true),
  /** tipo de voz que se busca entre las instaladas */
  gender: z.enum(["female", "male"]).default("female"),
  /** nombre exacto de una voz instalada; vacío = elegir sola según `gender` */
  voiceName: z.string().max(120).default(""),
  rate: z.number().min(0.5).max(1.8).default(1),
  volume: z.number().min(0).max(1).default(1),
  /** lee también la pregunta antes de responder ("Valentina pregunta: ...") */
  readQuestion: z.boolean().default(false),
});
export type AgentVoice = z.infer<typeof AgentVoiceSchema>;

export interface VoiceLike {
  name: string;
  lang: string;
}

const FEMALE_RE = /(sabina|helena|elena|laura|paulina|dalia|camila|salome|elvira|lucia|valentina|monica|paloma|marisol|esperanza|female|mujer|femenin)/i;
const MALE_RE = /(pablo|raul|jorge|diego|alvaro|juan|carlos|andres|enrique|tomas|alonso|gonzalo|\bmale\b|hombre|masculin)/i;
const LATAM_RE = /^es[-_](mx|us|419|ar|co|pe|cl|ve|uy|ec|bo|py|cr|gt|hn|ni|pa|pr|do|sv|cu)/i;

/**
 * Elige entre las voces instaladas la que mejor encaja: solo español; el nombre exacto manda;
 * luego el género por el nombre (mujer/hombre), el español latino y las voces "Online"/"Natural".
 * Devuelve undefined si no hay voz en español (el navegador usará la suya por defecto).
 */
export function pickVoice<T extends VoiceLike>(voices: T[], voice: Pick<AgentVoice, "gender" | "voiceName">): T | undefined {
  const exact = voice.voiceName ? voices.find((v) => v.name === voice.voiceName) : undefined;
  if (exact) return exact;
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const v of voices) {
    if (!/^es/i.test(v.lang)) continue;
    const female = FEMALE_RE.test(v.name);
    const male = !female && MALE_RE.test(v.name);
    let score = 0;
    if (voice.gender === "female") score += female ? 10 : male ? -10 : 0;
    else score += male ? 10 : female ? -10 : 0;
    if (LATAM_RE.test(v.lang)) score += 3;
    if (/(online|natural)/i.test(v.name)) score += 2;
    if (/google/i.test(v.name)) score += 1;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/** La misma regla de `pickVoice` como JS para la página del overlay (un test comprueba que dan lo mismo). */
export const PICK_VOICE_JS = String.raw`
  function pickVoice(voices, gender, voiceName) {
    var FEMALE = /(sabina|helena|elena|laura|paulina|dalia|camila|salome|elvira|lucia|valentina|monica|paloma|marisol|esperanza|female|mujer|femenin)/i;
    var MALE = /(pablo|raul|jorge|diego|alvaro|juan|carlos|andres|enrique|tomas|alonso|gonzalo|\bmale\b|hombre|masculin)/i;
    var LATAM = /^es[-_](mx|us|419|ar|co|pe|cl|ve|uy|ec|bo|py|cr|gt|hn|ni|pa|pr|do|sv|cu)/i;
    var i, v;
    if (voiceName) { for (i = 0; i < voices.length; i++) if (voices[i].name === voiceName) return voices[i]; }
    var best = null, bestScore = -Infinity;
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      if (!/^es/i.test(v.lang)) continue;
      var female = FEMALE.test(v.name), male = !female && MALE.test(v.name), score = 0;
      if (gender === "female") score += female ? 10 : male ? -10 : 0;
      else score += male ? 10 : female ? -10 : 0;
      if (LATAM.test(v.lang)) score += 3;
      if (/(online|natural)/i.test(v.name)) score += 2;
      if (/google/i.test(v.name)) score += 1;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }
`;

// ---------------------------------------------------------------------------
// Trivia (fase b): preguntas con opciones cuando el chat está tranquilo
// ---------------------------------------------------------------------------

export const AgentTriviaConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** la trivia sale sola cuando nadie comenta ni regala durante tantos segundos */
  idleSec: z.number().int().min(15).max(1800).default(90),
  /** tiempo para responder */
  answerSec: z.number().int().min(10).max(120).default(30),
  /** opciones por pregunta */
  options: z.union([z.literal(3), z.literal(4)]).default(4),
  difficulty: z.enum(["facil", "media", "dificil"]).default("media"),
  /** temas, separados por comas; el agente elige uno al azar */
  topics: z.string().max(200).default("cultura general, ciencia, geografía, historia, cine y música"),
  /** tope de trivias por hora (cada una gasta una llamada al modelo) */
  maxPerHour: z.number().int().min(1).max(60).default(12),
  /** monedas de prioridad del premio: quien acierta pasa primero en su próxima pregunta al agente */
  prizeCoins: z.number().int().min(1).max(1000).default(5),
});
export type AgentTriviaConfig = z.infer<typeof AgentTriviaConfigSchema>;

export const TRIVIA_DIFFICULTY_NAMES: Record<AgentTriviaConfig["difficulty"], string> = {
  facil: "Fácil",
  media: "Media",
  dificil: "Difícil",
};

export const AgentTriviaStateSchema = z.object({
  /** `generating`: el modelo prepara la pregunta · `open`: se puede responder · `reveal`: se enseña la respuesta */
  phase: z.enum(["idle", "generating", "open", "reveal"]),
  question: z.string().optional(),
  /** vacío hasta que la pregunta se abre */
  options: z.array(z.string()).default([]),
  /** cuándo se cierra (epoch ms); 0 si no hay pregunta abierta */
  deadline: z.number(),
  /** cuánta gente respondió */
  answers: z.number().int().nonnegative(),
  /** índice de la opción correcta: SOLO se manda al enseñar la respuesta (el overlay lo puede leer cualquiera) */
  correct: z.number().int().nonnegative().optional(),
  winner: z.object({ name: z.string(), avatarUrl: z.string().min(1).optional() }).optional(),
  startedAt: z.number(),
});
export type AgentTriviaState = z.infer<typeof AgentTriviaStateSchema>;

/** ¿El comentario es una respuesta de trivia ("a", "B", "c)", "D.")? Devuelve el índice (0 = A), o undefined. */
export function parseTriviaAnswer(text: string | undefined): number | undefined {
  const m = /^\s*([a-dA-D])\s*[.)]?\s*$/.exec(text ?? "");
  return m ? m[1].toLowerCase().charCodeAt(0) - 97 : undefined;
}

export const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** nombre con el que se presenta el agente */
  name: z.string().min(1).max(30).default("Asistente IA"),
  /** primera palabra del comentario que lo activa (p. ej. "!ia") */
  command: z.string().min(1).max(20).regex(/^\S+$/, "el comando no lleva espacios").default("!ia"),
  eligibility: AgentEligibilitySchema.default({}),
  /** una pregunta gratis cada tantos segundos (las de regalo no esperan) */
  freeEverySec: z.number().int().min(5).max(600).default(45),
  /** cuántos minutos vale el crédito que da un regalo para la siguiente pregunta de esa persona */
  giftCreditMin: z.number().int().min(1).max(120).default(10),
  /** preguntas que caben en la cola; las siguientes se descartan */
  maxQueue: z.number().int().min(5).max(200).default(50),
  /** largo máximo de una pregunta (lo demás se corta) */
  maxQuestionChars: z.number().int().min(20).max(300).default(150),
  /** cada persona espera tanto antes de volver a preguntar (evita el spam) */
  userCooldownSec: z.number().int().min(0).max(3600).default(30),
  /** tope de llamadas al modelo por LIVE (protege tu saldo); al llegar, el agente deja de responder */
  maxModelCalls: z.number().int().min(1).max(5000).default(300),
  /** qué modelo responde */
  provider: AgentProviderIdSchema.default("deepseek"),
  /** nombre del modelo; vacío = el de fábrica del proveedor */
  model: z.string().max(80).default(""),
  /** cómo quieres que hable (tono, humor...); se suma a las reglas fijas */
  personality: z.string().max(300).default(""),
  voice: AgentVoiceSchema.default({}),
  trivia: AgentTriviaConfigSchema.default({}),
  style: OverlayStyleSchema.default({ designId: "panel" }),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const DEFAULT_AGENT_CONFIG: AgentConfig = AgentConfigSchema.parse({});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export const AgentQueueItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  question: z.string(),
  /** monedas que respaldan esta pregunta (0 = gratis) */
  coins: z.number().int().nonnegative(),
  at: z.number(),
});
export type AgentQueueItem = z.infer<typeof AgentQueueItemSchema>;

export const AgentCurrentSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().min(1).optional(),
  question: z.string(),
  coins: z.number().int().nonnegative(),
  /** vacío mientras el agente "piensa" */
  answer: z.string(),
  startedAt: z.number(),
  /** cuánto se queda la respuesta en pantalla (ms); 0 mientras piensa */
  showMs: z.number().int().nonnegative(),
});
export type AgentCurrent = z.infer<typeof AgentCurrentSchema>;

export const AgentStateSchema = z.object({
  /** cuántas preguntas esperan */
  queueSize: z.number().int().nonnegative(),
  /** las primeras de la fila (máx. 5), en el orden en que se atenderán las de regalo */
  queue: z.array(AgentQueueItemSchema),
  current: AgentCurrentSchema.optional(),
  /** a partir de cuándo (epoch ms) puede salir la siguiente pregunta gratis */
  nextFreeAt: z.number(),
  /** cuántas respuestas lleva en esta sesión */
  answered: z.number().int().nonnegative(),
  updatedAt: z.number(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentFileSchema = z.object({
  config: AgentConfigSchema.default({}),
});
export type AgentFile = z.infer<typeof AgentFileSchema>;

/**
 * Mensajes del canal WS `agente`.
 *  - `get-state`  cualquiera → sidecar
 *  - `state`      sidecar → todos: configuración y estado de la cola
 *  - `save`       UI → sidecar: cambia la configuración
 *  - `ask`        UI → sidecar: pregunta de prueba (con `coins` > 0 es "de regalo"); no pasa por el chat
 *  - `reset`      UI → sidecar: vacía la cola y la respuesta en pantalla
 *  - `trivia-start` / `trivia-cancel`  UI → sidecar: lanza o cancela una trivia ahora
 *  - `set-key` / `remove-key`  UI → sidecar: guarda o borra la clave de un proveedor (solo en tu equipo)
 *  - `test-connection`         UI → sidecar: hace una llamada mínima al modelo; responde con `test-result`
 *  - `error`      sidecar → UI
 */
export const AgentMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("get-state") }),
  z.object({
    kind: z.literal("state"),
    config: AgentConfigSchema,
    state: AgentStateSchema,
    keys: z.record(AgentProviderIdSchema, z.boolean()),
    /** llamadas al modelo en este LIVE */
    modelCalls: z.number().int().nonnegative(),
    trivia: AgentTriviaStateSchema,
    serverNow: z.number(),
  }),
  z.object({ kind: z.literal("save"), config: AgentConfigSchema }),
  z.object({
    kind: z.literal("ask"),
    name: z.string().min(1).max(30),
    question: z.string().min(1).max(300),
    coins: z.number().int().min(0).max(1_000_000).default(0),
  }),
  z.object({ kind: z.literal("reset") }),
  // `sample`: usa una pregunta de ejemplo en vez de pedirla al modelo (para probar sin clave ni gasto)
  z.object({ kind: z.literal("trivia-start"), sample: z.boolean().default(false) }),
  z.object({ kind: z.literal("trivia-cancel") }),
  // la clave viaja una sola vez de la app al sidecar, que la guarda en tu equipo; nunca se devuelve
  z.object({ kind: z.literal("set-key"), provider: AgentProviderIdSchema, key: z.string().trim().min(8).max(300) }),
  z.object({ kind: z.literal("remove-key"), provider: AgentProviderIdSchema }),
  z.object({ kind: z.literal("test-connection"), provider: AgentProviderIdSchema }),
  z.object({ kind: z.literal("test-result"), provider: AgentProviderIdSchema, ok: z.boolean(), message: z.string(), ms: z.number() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/** ¿El comentario empieza por el comando? Devuelve la pregunta (sin el comando), o undefined si no es para el agente. */
export function parseAgentCommand(command: string, text?: string): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  const space = t.search(/\s/);
  const first = space === -1 ? t : t.slice(0, space);
  if (first.toLowerCase() !== command.trim().toLowerCase()) return undefined;
  return space === -1 ? "" : t.slice(space + 1).trim();
}
