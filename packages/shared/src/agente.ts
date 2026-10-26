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
  { id: "deepseek", name: "DeepSeek", api: "openai", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-v4-pro", keyUrl: "platform.deepseek.com" },
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
  /** de dónde sale el audio: la voz del equipo (`system`) o una voz humana generada en la nube (`gemini`) */
  provider: z.enum(["system", "gemini"]).default("system"),
  /** voz de Gemini (ver `GEMINI_VOICES`) */
  geminiVoice: z.string().max(40).default("Sulafat"),
  /** modelo de voz de Gemini; se puede cambiar si Google lo renueva */
  geminiModel: z.string().max(60).default("gemini-3.8-flash-tts"),
  /** cómo debe sonar: tono, calidez, acento. Se suma al ánimo de cada frase */
  style: z.string().max(200).default("cálida, serena y cercana, con acento latino neutro"),
  /** tope de audios generados por LIVE (protege tu saldo); al llegar, vuelve a la voz del equipo */
  maxCloudCalls: z.number().int().min(1).max(5000).default(400),
});
export type AgentVoice = z.infer<typeof AgentVoiceSchema>;

/** Voces de Gemini (nombres de Google) con su carácter, para elegir al oído. Se muestran en "Probar voces". */
export const GEMINI_VOICES: { id: string; trait: string; female: boolean }[] = [
  { id: "Sulafat", trait: "cálida", female: true },
  { id: "Achird", trait: "amistosa", female: false },
  { id: "Vindemiatrix", trait: "suave", female: true },
  { id: "Leda", trait: "juvenil", female: true },
  { id: "Kore", trait: "firme", female: true },
  { id: "Aoede", trait: "ligera", female: true },
  { id: "Callirrhoe", trait: "relajada", female: true },
  { id: "Despina", trait: "fluida", female: true },
  { id: "Puck", trait: "alegre", female: false },
  { id: "Zephyr", trait: "brillante", female: true },
  { id: "Charon", trait: "informativa", female: false },
  { id: "Fenrir", trait: "entusiasta", female: false },
  { id: "Orus", trait: "firme", female: false },
  { id: "Algieba", trait: "suave", female: false },
  { id: "Gacrux", trait: "madura", female: true },
  { id: "Iapetus", trait: "clara", female: false },
];

/** Ánimo de una frase: cambia el matiz con que se dice (el estilo base de la voz no se pierde). */
export const TTS_MOODS = ["calm", "happy", "excited", "mystery"] as const;
export type TtsMood = (typeof TTS_MOODS)[number];

// ---------------------------------------------------------------------------
// Ánimo del LIVE: qué tan movido va el LIVE (monedas, comentarios, likes...) y cómo se nota en el agente
// ---------------------------------------------------------------------------

export const AgentAnimoSchema = z.object({
  /** el ánimo del LIVE elige el tono de la voz (si la frase no pide uno concreto) */
  enabled: z.boolean().default(true),
  /** cuánto cuesta "animar" al agente: más alto = se anima con menos movimiento (0.5 a 2) */
  sensitivity: z.number().min(0.5).max(2).default(1),
  /** también le dice al modelo cómo va el LIVE, para que responda con ese tono */
  textContext: z.boolean().default(true),
});
export type AgentAnimo = z.infer<typeof AgentAnimoSchema>;

export const ANIMO_LEVELS = ["calm", "normal", "lively", "hype"] as const;
export type AnimoLevel = (typeof ANIMO_LEVELS)[number];
export const ANIMO_LEVEL_NAMES: Record<AnimoLevel, string> = { calm: "Tranquilo", normal: "Normal", lively: "Animado", hype: "A tope" };

export const AnimoStateSchema = z.object({
  /** energía del LIVE, 0 a 100 */
  energy: z.number().min(0).max(100),
  level: z.enum(ANIMO_LEVELS),
  /** ánimo que tendrá la próxima frase hablada (un regalo grande lo sube un rato) */
  mood: z.enum(TTS_MOODS),
  /** hay un subidón en curso (regalo grande o prueba) */
  spike: z.boolean(),
});
export type AnimoState = z.infer<typeof AnimoStateSchema>;

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
  /** al enseñar la respuesta: cuánta gente eligió cada opción (en el orden de `options`) */
  tally: z.array(z.number().int().nonnegative()).optional(),
  /** índice de la opción correcta: SOLO se manda al enseñar la respuesta (el overlay lo puede leer cualquiera) */
  correct: z.number().int().nonnegative().optional(),
  winner: z.object({ name: z.string(), avatarUrl: z.string().min(1).optional() }).optional(),
  startedAt: z.number(),
});
export type AgentTriviaState = z.infer<typeof AgentTriviaStateSchema>;

/** Minúsculas, sin tildes ni signos ni emojis, con los espacios juntos: para comparar lo que escribe la gente con la letra o la opción. */
export function normalizeTriviaText(text: string | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ANSWER_FILLERS = "(?:(?:la|el|opcion|respuesta|resp|letra|es|seria|sera|creo|que|yo|digo|voto|por|mi|va|la)\\s+)*";
const ANSWER_RE = new RegExp("^" + ANSWER_FILLERS + "([a-d])$");

/**
 * ¿El comentario es una respuesta de trivia? Vale la letra sola con signos o emojis ("a", "B", "c)", "D.", "A!", "a 😀") y con
 * palabras de relleno ("la a", "opción b", "la respuesta es c", "creo que es d"). Devuelve el índice (0 = A), o undefined.
 * Si pasas las opciones, también vale escribir la opción tal cual ("Lima", "a lima").
 */
export function parseTriviaAnswer(text: string | undefined, options?: readonly string[]): number | undefined {
  const t = normalizeTriviaText(text);
  if (!t) return undefined;
  const m = ANSWER_RE.exec(t);
  if (m) return m[1].charCodeAt(0) - 97;
  if (options) {
    // «a lima» / «a: lima» / «lima»
    const rest = t.replace(/^[a-d] /, "");
    for (let i = 0; i < options.length; i++) {
      const o = normalizeTriviaText(options[i]);
      if (o && (t === o || rest === o)) return i;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Avisos periódicos (fase d): el agente explica solo cómo participar
// ---------------------------------------------------------------------------

export const AgentTipsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** un aviso cada tantos segundos (solo si no está respondiendo ni hay trivia abierta) */
  everySec: z.number().int().min(30).max(3600).default(300),
  /** tus propios avisos, que salen después de los de fábrica (uno por línea, máx. 140 caracteres) */
  custom: z.array(z.string().trim().min(1).max(140)).max(5).default([]),
  /** avisos a cada persona: «tu pregunta está en la fila», «subió a Prioridad», gracias por el regalo */
  personal: z.boolean().default(true),
  /** un gracias agrupado (con sus nombres) a quienes siguen el canal */
  thanksFollows: z.boolean().default(true),
  /** esos gracias (regalo y seguidores) también se leen en voz alta */
  speakThanks: z.boolean().default(true),
});
export type AgentTipsConfig = z.infer<typeof AgentTipsConfigSchema>;

/**
 * Los avisos según cómo tengas configurado el agente: cómo preguntar y quién puede, que los regalos dan
 * prioridad y, si está activada, cómo se juega la trivia; luego los tuyos.
 */
export function buildTips(c: Pick<AgentConfig, "name" | "command" | "eligibility" | "freeEverySec" | "trivia" | "voice"> & { tips: AgentTipsConfig }): string[] {
  const who: string[] = [];
  if (c.eligibility.follow) who.push("sigues el canal");
  if (c.eligibility.share) who.push("compartes el LIVE");
  if (c.eligibility.fanClub) who.push("eres del Fan Club");
  if (c.eligibility.gift) who.push("mandas un regalo");
  const out: string[] = [];
  if (who.length > 0) {
    const last = who.length > 1 ? ` o ${who[who.length - 1]}` : "";
    const first = who.length > 1 ? who.slice(0, -1).join(", ") : who[0];
    out.push(`Haz tu pregunta: escribe ${c.command} y tu pregunta en el chat. Puedes preguntar si ${first}${last}.`);
  }
  if (c.eligibility.gift) out.push(`Un regalo te da prioridad: cuantas más monedas, antes sale tu pregunta. Sin regalo, sale una cada ${c.freeEverySec} segundos.`);
  if (c.trivia.enabled) {
    const letters = ["A", "B", "C", "D"].slice(0, c.trivia.options);
    out.push(`Trivia: responde en el chat con ${letters.slice(0, -1).join(", ")} o ${letters[letters.length - 1]}. El primero que acierte gana prioridad para su próxima pregunta.`);
  }
  return [...out, ...c.tips.custom];
}

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "un color como #ffc94d");

/** El personaje 3D (`/overlay/agente/personaje`): sus colores y el fondo para el LIVE. */
export const AgentCharacterSchema = z.object({
  /** color de la bufanda */
  scarfColor: HexColorSchema.default("#ffc94d"),
  /** color del pelo */
  hairColor: HexColorSchema.default("#3a3f9e"),
  /** "transparent" deja solo la figura; "chroma" pone verde puro (#00b140) para quitarlo con el filtro de croma del LIVE */
  background: z.enum(["transparent", "chroma"]).default("transparent"),
  /** muestra el piso donde está parado */
  floor: z.boolean().default(true),
});
export type AgentCharacter = z.infer<typeof AgentCharacterSchema>;

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
  /** qué es tu canal (nombre, de qué trata, qué es la app...): el agente lo usa para responder sobre ti */
  liveContext: z.string().max(500).default(""),
  /** respuestas libres: contesta de cualquier tema, también opiniones y dudas (con «creo que…»), y da información general de política, salud, leyes o inversión; los filtros de seguridad siguen */
  freeAnswers: z.boolean().default(true),
  voice: AgentVoiceSchema.default({}),
  animo: AgentAnimoSchema.default({}),
  trivia: AgentTriviaConfigSchema.default({}),
  tips: AgentTipsConfigSchema.default({}),
  character: AgentCharacterSchema.default({}),
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

/** Gestos del cuerpo del personaje 3D que puede pedir la IA con su respuesta. */
export const AGENT_GESTURES = ["none", "wave", "nod", "think", "jump", "laugh", "shrug", "shy"] as const;
export type AgentGesture = (typeof AGENT_GESTURES)[number];

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
  /** cómo se siente la IA con esta respuesta (la elige el modelo): da el tono de la voz y la cara del personaje */
  mood: z.enum(TTS_MOODS).optional(),
  /** gesto del cuerpo que acompaña la respuesta (lo elige el modelo) */
  gesture: z.enum(AGENT_GESTURES).optional(),
});
export type AgentCurrent = z.infer<typeof AgentCurrentSchema>;

/** Aviso a una persona (sale unos segundos en la barra y, si `speak`, se lee en voz alta). */
export const AgentNoticeSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["queue", "gift", "thanks"]),
  speak: z.boolean(),
  /** ánimo de la voz al leerlo */
  mood: z.enum(TTS_MOODS),
});
export type AgentNotice = z.infer<typeof AgentNoticeSchema>;

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
  /** aviso periódico en pantalla (cómo participar) */
  tip: z.object({ id: z.string(), text: z.string() }).optional(),
  /** avisos a cada persona que están a la vista ahora (máx. 3) */
  notices: z.array(AgentNoticeSchema).optional(),
  /** último fallo del modelo (sin clave, modelo inexistente, sin saldo…): solo lo muestra la app, nunca el overlay */
  lastError: z.object({ message: z.string(), at: z.number() }).optional(),
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
 *  - `tip-now`    UI → sidecar: muestra el siguiente aviso periódico ya
 *  - `set-key` / `remove-key`  UI → sidecar: guarda o borra la clave de un proveedor (solo en tu equipo)
 *  - `test-connection`         UI → sidecar: hace una llamada mínima al modelo; responde con `test-result`
 *  - `list-models`             UI → sidecar: pide a la API del proveedor su lista de modelos; responde con `models`
 *  - `animo-test` UI → sidecar: sube el ánimo del LIVE unos segundos (prueba)
 *  - `list-voice-models`       UI → sidecar: pide a Gemini sus modelos de voz; responde con `voice-models`
 *  - `tts`        overlay/UI → sidecar: pide el audio de una frase a la voz de la nube; responde con `tts-audio`
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
    /** copias del overlay que leen la voz y están conectadas ahora (LIVE Studio puede abrir dos de la misma fuente) */
    voiceOverlays: z.number().int().nonnegative().optional(),
    /** audios de la nube generados en este LIVE (para el tope `maxCloudCalls`) */
    ttsCalls: z.number().int().nonnegative().optional(),
    /** cómo va el LIVE ahora (energía y ánimo) */
    animo: AnimoStateSchema.optional(),
  }),
  // el overlay del stream se presenta al conectar (la vista previa de la app no); `speaks` = esta copia lee en voz alta
  z.object({ kind: z.literal("overlay-hello"), speaks: z.boolean() }),
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
  // muestra el siguiente aviso ahora (para probarlo)
  z.object({ kind: z.literal("tip-now") }),
  // la clave viaja una sola vez de la app al sidecar, que la guarda en tu equipo; nunca se devuelve
  z.object({ kind: z.literal("set-key"), provider: AgentProviderIdSchema, key: z.string().trim().min(8).max(300) }),
  z.object({ kind: z.literal("remove-key"), provider: AgentProviderIdSchema }),
  z.object({ kind: z.literal("test-connection"), provider: AgentProviderIdSchema }),
  z.object({ kind: z.literal("test-result"), provider: AgentProviderIdSchema, ok: z.boolean(), message: z.string(), ms: z.number() }),
  z.object({ kind: z.literal("list-models"), provider: AgentProviderIdSchema }),
  // `models`: ids de modelos de chat tal como los da el proveedor (sin lista fija en la app); `ok: false` trae el motivo
  z.object({ kind: z.literal("models"), provider: AgentProviderIdSchema, ok: z.boolean(), models: z.array(z.string()), message: z.string() }),
  // pide el audio de una frase a la voz de la nube; `voice`/`style`/`model` solo se usan al probar (si faltan, manda la configuración guardada)
  z.object({
    kind: z.literal("tts"),
    id: z.string().min(1).max(80),
    text: z.string().min(1).max(600),
    // `auto` = el que marque el ánimo del LIVE ahora (si está activado)
    mood: z.enum(["auto", ...TTS_MOODS]).default("auto"),
    voice: z.string().max(40).optional(),
    style: z.string().max(200).optional(),
    model: z.string().max(60).optional(),
  }),
  // prueba: sube el ánimo del LIVE un rato (para ver y oír cómo reacciona el agente sin esperar un regalo grande)
  z.object({ kind: z.literal("animo-test") }),
  // respuesta a `tts` (solo a quien la pidió): audio WAV en base64, o `ok: false` con el motivo
  z.object({ kind: z.literal("tts-audio"), id: z.string(), ok: z.boolean(), message: z.string(), mime: z.string(), data: z.string() }),
  // pide a Gemini sus modelos de voz (los que traen «tts» en el nombre); responde con `voice-models`
  z.object({ kind: z.literal("list-voice-models") }),
  z.object({ kind: z.literal("voice-models"), ok: z.boolean(), models: z.array(z.string()), message: z.string() }),
  // el overlay que habla avisa cuándo suena la voz y con qué fuerza (0 a 1; -1 = no se sabe, p. ej. la voz del equipo);
  // el sidecar lo reenvía a todos y el personaje 3D mueve la boca con eso
  z.object({ kind: z.literal("speech"), speaking: z.boolean(), level: z.number().min(-1).max(1) }),
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
