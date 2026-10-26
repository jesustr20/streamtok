import { EventEmitter } from "node:events";
import { AGENT_PROVIDERS, providerInfo, type AgentConfig, type AgentKeyStatus, type AgentProviderId } from "@streamtok/shared";
import type { Responder } from "./agente.js";
import { REFUSAL, cleanAnswer, looksLikeInjection, parseExpression, sanitizeQuestion, systemPrompt, userPrompt } from "./agente-guard.js";
import type { KeysStorePort } from "./agente-keys.js";
import { parseTrivia, type TriviaQuestion } from "./agente-trivia.js";

/** Cuánto esperamos al modelo antes de rendirnos. */
const TIMEOUT_MS = 20_000;
/** Tokens de salida: unas tres frases (≤400 caracteres) caben de sobra y así una respuesta nunca sale cara. */
const MAX_TOKENS = 300;
/** Espera máxima para pedir la lista de modelos. */
const LIST_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ModelCall {
  provider: AgentProviderId;
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

function httpMessage(provider: AgentProviderId, status: number, body: string): string {
  const name = providerInfo(provider).name;
  if (status === 401 || status === 403) return `${name} rechazó la clave (error ${status}).`;
  if (status === 402) return `${name}: sin saldo (error 402).`;
  if (status === 429) return `${name}: demasiadas llamadas o límite de uso (error 429).`;
  let detail = "";
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string };
    detail = typeof j.error === "string" ? j.error : (j.error?.message ?? "");
  } catch {
    /* sin detalle */
  }
  // 400/404 que hablan del modelo: el nombre no existe para este proveedor (o ya no se ofrece)
  const modelHint = (status === 400 || status === 404) && /model/i.test(detail) ? " Elige otro modelo en Agente IA → Modelo de IA." : "";
  return `${name} respondió con error ${status}${detail ? `: ${detail.slice(0, 120).replace(/[.\s]+$/, "")}` : ""}.${modelHint}`;
}

/** Ids que no sirven para conversar (imagen, audio, embeddings…). Se descartan por la palabra, no por un nombre de modelo concreto. */
const NOT_CHAT = /(embed|whisper|tts|dall-?e|image|imagen|audio|moderation|realtime|transcribe|speech|veo|aqa|guard|rerank|diffusion)/i;
const MAX_LISTED = 60;

/**
 * De la respuesta de `GET /models` (formato OpenAI o Anthropic) saca los ids de modelos de chat:
 * sin el prefijo `models/` de Gemini, sin repetidos, sin los de imagen/audio, lo más nuevo primero
 * cuando el proveedor da la fecha (`created`) y en el orden recibido si no.
 */
export function chatModelIds(json: unknown): string[] {
  const data = (json as { data?: unknown; models?: unknown } | null)?.data ?? (json as { models?: unknown } | null)?.models;
  if (!Array.isArray(data)) return [];
  const items: { id: string; created: number }[] = [];
  for (const raw of data) {
    const r = raw as { id?: unknown; name?: unknown; created?: unknown } | string;
    const id0 = typeof r === "string" ? r : typeof r?.id === "string" ? r.id : typeof r?.name === "string" ? r.name : "";
    const id = id0.replace(/^models\//, "").trim();
    if (!id || id.length > 80 || NOT_CHAT.test(id) || items.some((i) => i.id === id)) continue;
    items.push({ id, created: typeof r === "object" && typeof r?.created === "number" ? r.created : 0 });
  }
  if (items.length > 1 && items.every((i) => i.created > 0)) items.sort((a, b) => b.created - a.created);
  return items.slice(0, MAX_LISTED).map((i) => i.id);
}

/** La lista de modelos que ofrece el proveedor con la clave del streamer (no gasta saldo). */
export async function fetchModelList(fetchImpl: FetchLike, provider: AgentProviderId, key: string): Promise<string[]> {
  const info = providerInfo(provider);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_TIMEOUT_MS);
  try {
    const anthropic = info.api === "anthropic";
    const url = anthropic ? `${info.baseUrl}/v1/models?limit=100` : `${info.baseUrl}/models`;
    const headers: Record<string, string> = anthropic ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${key}` };
    let res;
    try {
      res = await fetchImpl(url, { method: "GET", headers, signal: ctrl.signal });
    } catch (err) {
      if (ctrl.signal.aborted) throw new Error(`${info.name} tardó más de ${LIST_TIMEOUT_MS / 1000} s en dar su lista de modelos.`);
      throw new Error(`No se pudo conectar con ${info.name}: ${scrub((err as Error).message, key)}`);
    }
    const raw = await res.text();
    if (!res.ok) throw new Error(scrub(httpMessage(provider, res.status, raw), key));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`${info.name} devolvió algo que no se entiende.`);
    }
    const ids = chatModelIds(json);
    if (ids.length === 0) throw new Error(`${info.name} no devolvió ningún modelo de chat.`);
    return ids;
  } finally {
    clearTimeout(timer);
  }
}

/** Una llamada al modelo. Habla la API de OpenAI (DeepSeek, OpenAI, Gemini) o la de Claude. */
export async function callModel(fetchImpl: FetchLike, c: ModelCall): Promise<string> {
  const info = providerInfo(c.provider);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const anthropic = info.api === "anthropic";
    const url = anthropic ? `${info.baseUrl}/v1/messages` : `${info.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (anthropic) {
      headers["x-api-key"] = c.key;
      headers["anthropic-version"] = "2023-06-01";
    } else headers.authorization = `Bearer ${c.key}`;
    const body = anthropic
      ? { model: c.model, max_tokens: c.maxTokens, temperature: 0.3, system: c.system, messages: [{ role: "user", content: c.user }] }
      : {
          model: c.model,
          max_tokens: c.maxTokens,
          temperature: 0.3,
          messages: [
            { role: "system", content: c.system },
            { role: "user", content: c.user },
          ],
        };
    // DeepSeek V4 «piensa» por defecto y se gasta los tokens razonando (la respuesta llega vacía): para respuestas cortas de un LIVE se apaga.
    const noThinking = c.provider === "deepseek" && !anthropic;
    const send = async (b: object): Promise<{ res: Awaited<ReturnType<FetchLike>>; raw: string }> => {
      let r;
      try {
        r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(b), signal: ctrl.signal });
      } catch (err) {
        if (ctrl.signal.aborted) throw new Error(`${info.name} tardó más de ${TIMEOUT_MS / 1000} s en responder.`);
        throw new Error(`No se pudo conectar con ${info.name}: ${scrub((err as Error).message, c.key)}`);
      }
      return { res: r, raw: await r.text() };
    };
    let { res, raw } = await send(noThinking ? { ...body, thinking: { type: "disabled" } } : body);
    // si ese modelo no acepta el parámetro, se repite sin él
    if (noThinking && !res.ok && res.status === 400 && /thinking/i.test(raw)) ({ res, raw } = await send(body));
    if (!res.ok) throw new Error(scrub(httpMessage(c.provider, res.status, raw), c.key));
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`${info.name} devolvió algo que no se entiende.`);
    }
    const text: unknown = anthropic ? json?.content?.[0]?.text : json?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error(`${info.name} devolvió una respuesta vacía.`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Por si un mensaje de error de red trajera la clave. */
function scrub(message: string, key: string): string {
  return key ? message.split(key).join("***") : message;
}

export interface ModelServiceOptions {
  keys: KeysStorePort;
  fetchImpl?: FetchLike;
  /** línea sobre cómo va el LIVE (ánimo) que se suma a las reglas del modelo; el sidecar la arma, no los espectadores */
  liveContext?: () => string | undefined;
}

/**
 * Pone el modelo detrás del agente: guarda las claves, aplica las defensas y lleva la cuenta de
 * llamadas del LIVE. `respond` es el `Responder` del motor. Eventos: `log` ({level, message}), `state`.
 */
export class ModelService extends EventEmitter {
  private keys: Partial<Record<AgentProviderId, string>>;
  private fetchImpl: FetchLike;
  private calls = 0;
  private budgetWarned = false;
  private saving = false;
  private dirty = false;
  private idle: Promise<void> = Promise.resolve();

  constructor(private opts: ModelServiceOptions) {
    super();
    this.keys = { ...opts.keys.load().keys };
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  keyStatus(): AgentKeyStatus {
    const out = {} as AgentKeyStatus;
    for (const p of AGENT_PROVIDERS) out[p.id] = Boolean(this.keys[p.id]);
    return out;
  }

  /** Solo para uso dentro del sidecar (la voz de la nube usa la clave de Gemini); nunca se manda fuera. */
  keyFor(provider: AgentProviderId): string | undefined {
    return this.keys[provider];
  }

  get modelCalls(): number {
    return this.calls;
  }

  setKey(provider: AgentProviderId, key: string): void {
    this.keys[provider] = key.trim();
    this.persist();
    this.emit("state");
  }

  removeKey(provider: AgentProviderId): void {
    delete this.keys[provider];
    this.persist();
    this.emit("state");
  }

  /** Nuevo LIVE: el tope de llamadas vuelve a cero. */
  resetSession(): void {
    this.calls = 0;
    this.budgetWarned = false;
    this.emit("state");
  }

  flush(): Promise<void> {
    return this.idle;
  }

  readonly respond: Responder = async (rawQuestion, { config }) => {
    const question = sanitizeQuestion(rawQuestion);
    if (!question || looksLikeInjection(question)) return REFUSAL;
    const key = this.keys[config.provider];
    // Los fallos de configuración NO se contestan al público: el motor los apunta en el panel de la app.
    if (!key) throw new Error(`Falta la clave de ${providerInfo(config.provider).name}: guárdala en Agente IA → Modelo de IA.`);
    if (this.calls >= config.maxModelCalls) {
      if (!this.budgetWarned) {
        this.budgetWarned = true;
        this.emit("log", { level: "warn", message: `Se llegó al tope de ${config.maxModelCalls} llamadas al modelo en este LIVE; el agente deja de responder hasta el próximo.` });
      }
      throw new Error(`Tope de ${config.maxModelCalls} llamadas al modelo en este LIVE alcanzado (súbelo en Agente IA si quieres seguir).`);
    }
    this.calls++;
    this.emit("state");
    const request = { provider: config.provider, key, model: modelFor(config), system: systemPrompt(config, this.opts.liveContext?.()), user: userPrompt(question) };
    let text: string;
    try {
      text = await callModel(this.fetchImpl, { ...request, maxTokens: MAX_TOKENS });
    } catch (err) {
      // Los modelos que «piensan» a veces gastan todos los tokens razonando y devuelven el texto vacío: se reintenta una vez con más margen.
      if (!/respuesta vacía/.test((err as Error).message) || this.calls >= config.maxModelCalls) throw err;
      this.calls++;
      this.emit("state");
      text = await callModel(this.fetchImpl, { ...request, maxTokens: MAX_TOKENS * 4 });
    }
    // la etiqueta [emoción, gesto] se separa antes de limpiar (la limpieza quita barras y otros signos); si no hay, texto solo
    const expr = parseExpression(text);
    const clean = cleanAnswer(expr.text);
    return expr.mood || expr.gesture ? { ...expr, text: clean } : clean;
  };

  /**
   * Pide al modelo una pregunta de trivia (JSON con pregunta, opciones y correcta). Cuenta para el tope
   * de llamadas. Devuelve null si no hay clave, se llegó al tope o la respuesta no cuadra.
   */
  async generateTrivia(config: AgentConfig, recent: string[]): Promise<TriviaQuestion | null> {
    const key = this.keys[config.provider];
    if (!key) {
      this.emit("log", { level: "warn", message: "La trivia necesita una clave de modelo guardada." });
      return null;
    }
    if (this.calls >= config.maxModelCalls) return null;
    this.calls++;
    this.emit("state");
    const t = config.trivia;
    const topics = t.topics.split(",").map((x) => sanitizeQuestion(x)).filter(Boolean);
    const topic = topics.length > 0 ? topics[Math.floor(Math.random() * topics.length)] : "cultura general";
    const avoid = recent.slice(-8).map((q) => `- ${sanitizeQuestion(q)}`).join("\n");
    const request = {
      provider: config.provider,
      key,
      model: modelFor(config),
      system: [
        "Eres un creador de preguntas de trivia para el chat de un LIVE de TikTok.",
        "Responde SOLO con un JSON, sin texto antes ni después, con esta forma exacta:",
        `{"pregunta": "...", "opciones": [${Array.from({ length: t.options }, () => '"..."').join(", ")}], "correcta": 0}`,
        '"correcta" es la posición (empezando en 0) de la opción correcta.',
        "Reglas: en español; la pregunta de máximo 110 caracteres y cada opción de máximo 30; un solo dato verificable y sin ambigüedad; una sola opción correcta y las demás claramente falsas; nada ofensivo, sexual, violento ni de política partidista; sin enlaces.",
        "Si no estás completamente seguro de la respuesta, elige otra pregunta.",
      ].join("\n"),
      user: `Tema: ${topic}. Dificultad: ${t.difficulty}. Opciones: ${t.options}.${avoid ? `\nNo repitas estas preguntas:\n${avoid}` : ""}`,
    };
    let text: string;
    try {
      text = await callModel(this.fetchImpl, { ...request, maxTokens: 250 });
    } catch (err) {
      // Los modelos que «piensan» a veces gastan todos los tokens razonando y devuelven vacío: un reintento con más margen.
      if (!/respuesta vacía/.test((err as Error).message) || this.calls >= config.maxModelCalls) throw err;
      this.calls++;
      this.emit("state");
      text = await callModel(this.fetchImpl, { ...request, maxTokens: 250 * 6 });
    }
    const q = parseTrivia(text, t.options);
    if (!q) this.emit("log", { level: "warn", message: "El modelo devolvió una pregunta de trivia que no cumple el formato; se descarta." });
    return q;
  }

  /** Lista de modelos del proveedor (con su clave). Se guarda la última por proveedor para no repetir la consulta. */
  async listModels(provider: AgentProviderId): Promise<{ ok: boolean; models: string[]; message: string }> {
    const key = this.keys[provider];
    const name = providerInfo(provider).name;
    if (!key) return { ok: false, models: [], message: `Falta la clave de ${name}.` };
    try {
      const models = await fetchModelList(this.fetchImpl, provider, key);
      return { ok: true, models, message: `${models.length} modelos de ${name}.` };
    } catch (err) {
      return { ok: false, models: [], message: (err as Error).message };
    }
  }

  /** «Probar conexión»: una llamada mínima (no cuenta para el tope). */
  async testConnection(provider: AgentProviderId, config: AgentConfig): Promise<{ ok: boolean; message: string; ms: number }> {
    const key = this.keys[provider];
    const t0 = Date.now();
    if (!key) return { ok: false, message: `Falta la clave de ${providerInfo(provider).name}.`, ms: 0 };
    try {
      await callModel(this.fetchImpl, {
        provider,
        key,
        model: provider === config.provider ? modelFor(config) : providerInfo(provider).defaultModel,
        system: "Responde solo con la palabra: ok",
        user: "ping",
        maxTokens: 5,
      });
      return { ok: true, message: `${providerInfo(provider).name} responde bien.`, ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, message: (err as Error).message, ms: Date.now() - t0 };
    }
  }

  private persist(): void {
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    this.idle = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await this.opts.keys.save({ keys: { ...this.keys } });
        }
      } catch (err) {
        this.emit("log", { level: "error", message: `No se pudo guardar las claves: ${(err as Error).message}` });
      } finally {
        this.saving = false;
      }
    })();
  }
}

function modelFor(config: AgentConfig): string {
  return config.model.trim() || providerInfo(config.provider).defaultModel;
}
