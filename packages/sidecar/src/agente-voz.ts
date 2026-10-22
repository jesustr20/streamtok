import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { TtsMood } from "@streamtok/shared";
import type { FetchLike } from "./agente-model.js";

/**
 * Voz en la nube del agente (ADR 0016): convierte el texto de una frase en audio con Gemini TTS.
 * La clave es la de Gemini que ya está guardada para el modelo (nunca sale del sidecar); aquí solo
 * se usa. Guarda en memoria los audios ya generados (los "gracias" se repiten) y lleva la cuenta
 * y el ritmo de las llamadas para no gastar de más.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Espera máxima por un audio. */
const TIMEOUT_MS = 25_000;
/** Audios distintos que se recuerdan. */
const CACHE_MAX = 60;
/** Llamadas nuevas permitidas por minuto (el overlay no puede disparar el gasto). */
const RATE_PER_MIN = 20;
/** Largo máximo de una frase. */
const MAX_TEXT = 600;
/** Modelo de la API anterior, por si la de ahora no existiera en la cuenta del usuario. */
const LEGACY_MODEL = "gemini-2.5-flash-preview-tts";

const MOOD_STYLE: Record<TtsMood, string> = {
  calm: "",
  happy: "alegre, con una sonrisa en la voz y mucho agradecimiento",
  excited: "muy entusiasta y con energía, emocionada de verdad",
  mystery: "en voz baja y misteriosa, como contando un secreto",
};

/** Estilo final de una frase: el de la voz más el matiz del momento. */
export function buildStyle(base: string, mood: TtsMood): string {
  const b = base.trim();
  const m = MOOD_STYLE[mood];
  return [b, m].filter(Boolean).join(", ");
}

/**
 * Deja el texto listo para decirse: sin enlaces, emojis, marcas de formato ni etiquetas (`<risa>` y
 * `|así|` son órdenes para la voz de Gemini; si el modelo las escribiera sin querer, se leerían raro).
 */
export function speechText(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[|*_`#~^[\]{}\\]/g, " ")
    .replace(/[\p{Extended_Pictographic}‍️]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

/** Envuelve audio PCM de 16 bits, mono, en un WAV que cualquier navegador reproduce. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/**
 * Busca el audio en la respuesta de Gemini sin depender de una sola forma: la API nueva lo da como un
 * bloque `{type:"audio", data}` dentro de `steps[].content[]`; la anterior, como `inlineData.data`.
 * Devuelve el último que encuentre, ya como WAV.
 */
export function extractWav(json: unknown): Buffer | null {
  let found: { data: string; mime: string } | null = null;
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    if (o.type === "audio" && typeof o.data === "string" && o.data) {
      found = { data: o.data, mime: typeof o.mime_type === "string" ? o.mime_type : typeof o.mimeType === "string" ? o.mimeType : "" };
    }
    const inline = (o.inlineData ?? o.inline_data) as { data?: unknown; mimeType?: unknown; mime_type?: unknown } | undefined;
    if (inline && typeof inline.data === "string" && inline.data) {
      found = { data: inline.data, mime: String(inline.mimeType ?? inline.mime_type ?? "") };
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(json, 0);
  if (!found) return null;
  const { data, mime } = found as { data: string; mime: string };
  const buf = Buffer.from(data, "base64");
  if (buf.length < 64) return null;
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") return buf;
  const rate = /rate=(\d{4,6})/i.exec(mime);
  return pcmToWav(buf, rate ? Number(rate[1]) : 24000);
}

export interface TtsRequest {
  text: string;
  mood: TtsMood;
  voice: string;
  style: string;
  model: string;
}

export type TtsResult = { ok: true; wav: Buffer; cached: boolean } | { ok: false; message: string };

export interface VoiceServiceOptions {
  /** clave de Gemini guardada para el modelo de chat */
  getKey: () => string | undefined;
  fetchImpl?: FetchLike;
  now?: () => number;
}

function scrub(message: string, key: string): string {
  return key ? message.split(key).join("***") : message;
}

function httpMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return `Gemini rechazó la clave para la voz (error ${status}). Revisa que la clave tenga la API de Gemini activada.`;
  if (status === 429) return "Gemini: demasiadas llamadas o límite de uso del plan (error 429).";
  let detail = "";
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string };
    detail = typeof j.error === "string" ? j.error : (j.error?.message ?? "");
  } catch {
    /* sin detalle */
  }
  const hint = (status === 400 || status === 404) && /model/i.test(detail) ? " Cambia el modelo de voz en Voz → Voz en la nube." : "";
  return `Gemini respondió con error ${status}${detail ? `: ${detail.slice(0, 140).replace(/[.\s]+$/, "")}` : ""}.${hint}`;
}

/**
 * Genera el audio de una frase. Eventos: `state` (cambió el contador), `log` ({level, message}).
 */
export class VoiceService extends EventEmitter {
  private cache = new Map<string, Buffer>();
  private calls = 0;
  private recent: number[] = [];
  private fetchImpl: FetchLike;
  private now: () => number;

  constructor(private opts: VoiceServiceOptions) {
    super();
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
  }

  /** Audios nuevos generados en este LIVE (los de la memoria no cuentan). */
  get ttsCalls(): number {
    return this.calls;
  }

  /** Nuevo LIVE: el tope vuelve a cero (la memoria de audios se conserva: no cuesta nada). */
  resetSession(): void {
    this.calls = 0;
    this.emit("state");
  }

  async synthesize(req: TtsRequest, maxCalls: number): Promise<TtsResult> {
    const text = speechText(req.text);
    if (!text) return { ok: false, message: "No hay texto que decir." };
    const key = this.opts.getKey();
    if (!key) return { ok: false, message: "Falta la clave de Gemini: guárdala en Agente IA → Modelo de IA." };
    const style = buildStyle(req.style, req.mood);
    const id = createHash("sha1").update(`${req.model}|${req.voice}|${style}|${text}`).digest("hex");
    const hit = this.cache.get(id);
    if (hit) {
      // se vuelve a poner al final: lo usado hace poco se queda
      this.cache.delete(id);
      this.cache.set(id, hit);
      return { ok: true, wav: hit, cached: true };
    }
    if (this.calls >= maxCalls) return { ok: false, message: `Se llegó al tope de ${maxCalls} audios de la nube en este LIVE; sigue con la voz del equipo.` };
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < 60_000);
    if (this.recent.length >= RATE_PER_MIN) return { ok: false, message: "Demasiados audios seguidos; se espera un momento." };
    this.recent.push(t);
    this.calls += 1;
    this.emit("state");
    try {
      const wav = await this.callGemini(key, { ...req, text, style });
      this.cache.set(id, wav);
      while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      return { ok: true, wav, cached: false };
    } catch (err) {
      const message = scrub((err as Error).message, key);
      // una llamada que falló no cuenta para el tope
      this.calls = Math.max(0, this.calls - 1);
      this.emit("state");
      this.emit("log", { level: "warn", message: `Voz de la nube: ${message}` });
      return { ok: false, message };
    }
  }

  /** Modelos de voz (los que traen «tts» en el nombre) que ofrece Gemini con la clave guardada. */
  async listModels(): Promise<{ ok: boolean; models: string[]; message: string }> {
    const key = this.opts.getKey();
    if (!key) return { ok: false, models: [], message: "Falta la clave de Gemini: guárdala en Agente IA → Modelo de IA." };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${BASE}/models?pageSize=200`, { method: "GET", headers: { "x-goog-api-key": key }, signal: ctrl.signal });
      const raw = await res.text();
      if (!res.ok) return { ok: false, models: [], message: scrub(httpMessage(res.status, raw), key) };
      const list = ((safeJson(raw) as { models?: { name?: unknown }[] } | null)?.models ?? [])
        .map((m) => (typeof m.name === "string" ? m.name.replace(/^models\//, "") : ""))
        .filter((n) => /tts/i.test(n));
      const models = [...new Set(list)].sort();
      return models.length ? { ok: true, models, message: "" } : { ok: false, models: [], message: "Gemini no lista modelos de voz para esta clave." };
    } catch (err) {
      return { ok: false, models: [], message: `No se pudo conectar con Gemini: ${scrub((err as Error).message, key)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(url: string, key: string, body: unknown): Promise<{ status: number; ok: boolean; raw: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      return { status: res.status, ok: res.ok, raw: await res.text() };
    } catch (err) {
      throw new Error(`No se pudo conectar con Gemini: ${scrub((err as Error).message, key)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async callGemini(key: string, r: { text: string; voice: string; style: string; model: string }): Promise<Buffer> {
    // API actual: /interactions con el estilo como anotación del turno
    const first = await this.post(`${BASE}/interactions`, key, {
      model: r.model,
      input: [
        {
          type: "user_input",
          content: [{ type: "text", text: r.text, annotations: r.style ? [{ type: "speech_metadata", style: r.style }] : [] }],
        },
      ],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: r.voice }] },
    });
    if (first.ok) {
      const wav = extractWav(safeJson(first.raw));
      if (wav) return wav;
      throw new Error("Gemini respondió sin audio.");
    }
    // Si esa ruta no existe para esta cuenta (404 que no habla del modelo), se prueba la API anterior.
    if (first.status === 404 && !/model/i.test(first.raw)) {
      const second = await this.post(`${BASE}/models/${LEGACY_MODEL}:generateContent`, key, {
        contents: [{ parts: [{ text: r.style ? `Dilo ${r.style}: ${r.text}` : r.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: r.voice } } },
        },
      });
      if (second.ok) {
        const wav = extractWav(safeJson(second.raw));
        if (wav) return wav;
        throw new Error("Gemini respondió sin audio.");
      }
      throw new Error(httpMessage(second.status, second.raw));
    }
    throw new Error(httpMessage(first.status, first.raw));
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
