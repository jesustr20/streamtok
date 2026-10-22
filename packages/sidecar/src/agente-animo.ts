import { EventEmitter } from "node:events";
import type { AgentAnimo, AnimoLevel, AnimoState, LiveEvent, TtsMood } from "@streamtok/shared";

/**
 * Ánimo del LIVE (ADR 0016): mide qué tan movido va el LIVE y se lo dice al agente, para que su voz y su
 * tono sigan el momento en vez de ser siempre iguales.
 *
 * Cada cosa que pasa (comentario, regalo, like, seguidor nuevo...) suma puntos a un acumulador que se va
 * apagando solo (se queda con la mitad más o menos cada 40 s), así que la energía refleja el último par de
 * minutos. La energía (0 a 100) cae en uno de cuatro niveles con un margen, para que no oscile entre dos.
 * Un regalo grande, además, sube el ánimo de golpe un rato (reacción inmediata, sin esperar al promedio).
 *
 * Los pesos y los umbrales son un primer ajuste (calibrado con una grabación real, ver los tests); la
 * sensibilidad de la configuración los mueve y la pantalla «Agente IA» enseña la energía para afinar.
 */

/** Vida media aproximada del acumulador: τ = 60 s → la mitad en ~42 s. */
const TAU_MS = 60_000;
/** Puntos con los que la energía llega al ~63 % (con sensibilidad 1). */
const SCALE = 30;
/** Monedas de un solo regalo que cuentan como «regalo grande» (con sensibilidad 1). */
const BIG_GIFT_COINS = 150;
/** Cuánto dura el subidón de un regalo grande o de la prueba. */
const SPIKE_MS = 25_000;
/** Tope de monedas por regalo en el acumulador (lo demás ya lo cubre el subidón). */
const GIFT_COIN_CAP = 500;

/** Energía a partir de la cual se entra a cada nivel, y margen para salir. */
const ENTER: Record<AnimoLevel, number> = { calm: 0, normal: 18, lively: 50, hype: 78 };
const MARGIN = 6;
const ORDER: AnimoLevel[] = ["calm", "normal", "lively", "hype"];

const MOOD_OF: Record<AnimoLevel, TtsMood> = { calm: "calm", normal: "calm", lively: "happy", hype: "excited" };

/** Puntos que suma cada cosa que pasa en el LIVE. */
export function pointsFor(evt: LiveEvent): number {
  switch (evt.event) {
    case "comment":
      return 1.5;
    case "like":
      return Math.min(evt.likeCount ?? 1, 30) * 0.05;
    case "follow":
      return 5;
    case "share":
      return 6;
    case "subscribe":
      return 8;
    case "join":
      return 0.2;
    case "emote":
      return 1.5;
    case "fanLevelUp":
    case "donorLevelUp":
      return 3;
    case "gift":
      // un combo en curso avisa de movimiento; el cierre trae el total de monedas
      if (evt.repeatEnd === false) return 2;
      return Math.min(evt.coins ?? 0, GIFT_COIN_CAP) * 0.3;
    default:
      return 0;
  }
}

export interface LiveMoodOptions {
  getConfig: () => AgentAnimo;
  now?: () => number;
}

/**
 * Eventos: `state` (cambió lo que se enseña: nivel, ánimo o energía más de 3 puntos, como mucho cada 2 s).
 */
export class LiveMoodEngine extends EventEmitter {
  private acc = 0;
  private accAt: number;
  private level: AnimoLevel = "calm";
  private spikeUntil = 0;
  private shown: AnimoState | null = null;
  private shownAt = 0;
  private now: () => number;

  constructor(private opts: LiveMoodOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.accAt = this.now();
  }

  private sens(): number {
    return Math.min(2, Math.max(0.5, this.opts.getConfig().sensitivity));
  }

  private decay(t: number) {
    const dt = Math.max(0, t - this.accAt);
    if (dt > 0) this.acc *= Math.exp(-dt / TAU_MS);
    this.accAt = t;
  }

  handleLiveEvent(evt: LiveEvent): void {
    const t = this.now();
    this.decay(t);
    this.acc += pointsFor(evt);
    if (evt.event === "gift" && evt.repeatEnd !== false && (evt.coins ?? 0) >= BIG_GIFT_COINS / this.sens()) this.spikeUntil = t + SPIKE_MS;
    this.refresh(t);
  }

  /** Sube el ánimo unos segundos (botón de prueba, o más adelante una meta cumplida). */
  boost(ms = SPIKE_MS): void {
    const t = this.now();
    this.spikeUntil = Math.max(this.spikeUntil, t + ms);
    this.refresh(t, true);
  }

  /** Nuevo LIVE: empieza en calma. */
  reset(): void {
    this.acc = 0;
    this.accAt = this.now();
    this.level = "calm";
    this.spikeUntil = 0;
    this.refresh(this.accAt, true);
  }

  /** Para llamar cada segundo: la energía baja sola aunque no pase nada. */
  tick(): void {
    this.refresh(this.now());
  }

  private energyAt(t: number): number {
    const a = this.acc * Math.exp(-Math.max(0, t - this.accAt) / TAU_MS);
    return Math.min(100, 100 * (1 - Math.exp(-a / (SCALE / this.sens()))));
  }

  /** Nivel con margen: sube al llegar al umbral y baja solo cuando cae `MARGIN` por debajo. */
  private levelFor(energy: number): AnimoLevel {
    let i = ORDER.indexOf(this.level);
    while (i < ORDER.length - 1 && energy >= ENTER[ORDER[i + 1]]) i++;
    while (i > 0 && energy < ENTER[ORDER[i]] - MARGIN) i--;
    return ORDER[i];
  }

  private compute(t: number): AnimoState {
    const energy = this.energyAt(t);
    this.level = this.levelFor(energy);
    const spike = t < this.spikeUntil;
    return { energy: Math.round(energy), level: this.level, mood: spike ? "excited" : MOOD_OF[this.level], spike };
  }

  getState(): AnimoState {
    return this.compute(this.now());
  }

  private refresh(t: number, force = false) {
    const s = this.compute(t);
    const p = this.shown;
    const changed = !p || p.level !== s.level || p.mood !== s.mood || p.spike !== s.spike;
    const moved = !p || Math.abs(p.energy - s.energy) >= 3;
    if (force || changed || (moved && t - this.shownAt >= 2000)) {
      this.shown = s;
      this.shownAt = t;
      this.emit("state");
    }
  }

  /** Ánimo de la próxima frase hablada; `calm` si el ánimo del LIVE está apagado. */
  mood(): TtsMood {
    return this.opts.getConfig().enabled ? this.getState().mood : "calm";
  }

  /** Línea que se le pasa al modelo para que el texto siga el momento (o nada si no hay nada que decir). */
  contextLine(): string | undefined {
    const c = this.opts.getConfig();
    if (!c.enabled || !c.textContext) return undefined;
    const s = this.getState();
    if (s.spike) return "Acaba de llegar un regalo grande al LIVE: puedes mostrar entusiasmo y agradecimiento.";
    switch (s.level) {
      case "calm":
        return "El LIVE está tranquilo: responde con calma y calidez.";
      case "lively":
        return "El LIVE está animado: responde con buena energía y frases cortas.";
      case "hype":
        return "El LIVE está a tope de energía: responde con entusiasmo y frases muy cortas.";
      default:
        return undefined;
    }
  }
}
