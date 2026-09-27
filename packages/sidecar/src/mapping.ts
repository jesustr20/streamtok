import type {
  CommunityRule,
  CommunityRules,
  LiveEvent,
  MappingRule,
} from "@streamtok/shared";
import { defaultCommunityRules, isArenaAction } from "@streamtok/shared";
import type { ModBridge } from "./mod-bridge.js";

export type { MappingRule } from "@streamtok/shared";

/**
 * Motor de reglas evento de TikTok → mod-command. Esto es exactamente el
 * punto 3 de "Lo que la app necesita implementar" del contrato: la app
 * decide "tal regalo/comando → tal acción con tales parámetros", no el mod.
 *
 * Reglas persistidas/editadas desde la UI (Acciones y Eventos) — acá va
 * solo el motor de ejecución. El listado real de reglas vive en config
 * de usuario (ver mapping-rules.ts); esto es la forma mínima que necesita
 * la UI para guardarlas y para que el sidecar las corra.
 */

export class MappingEngine {
  private communityRules: CommunityRules = defaultCommunityRules();
  /** Likes acumulados desde el último reset (ver ADR 0003: "cada N likes"). */
  private likeCount = 0;

  constructor(
    private modBridge: ModBridge,
    private rules: MappingRule[] = [],
  ) {}

  setRules(rules: MappingRule[]) {
    this.rules = rules;
  }

  getRules(): MappingRule[] {
    return this.rules;
  }

  setCommunityRules(rules: CommunityRules) {
    this.communityRules = rules;
    this.likeCount = 0;
  }

  getCommunityRules(): CommunityRules {
    return this.communityRules;
  }

  /** Se llama por cada LiveEvent normalizado que llega del sidecar de TikTok. */
  async handleEvent(evt: LiveEvent) {
    // Streaks de regalo: solo actuar cuando termina el combo.
    if (evt.event === "gift" && evt.repeatEnd === false) return;

    for (const rule of this.rules) {
      if (!this.matches(rule, evt)) continue;

      const params = { ...rule.params };
      if (rule.passCoinsAsParam && typeof evt.coins === "number") {
        params[rule.passCoinsAsParam] = evt.coins;
      }

      await this.sendAction(rule.action, params, evt);
    }

    await this.handleCommunityEvent(evt);
  }

  private async handleCommunityEvent(evt: LiveEvent) {
    if (evt.event === "like") {
      const like = this.communityRules.like;
      if (!like.enabled || !like.action) return;
      this.likeCount += 1;
      if (this.likeCount % (like.everyNLikes ?? 1) !== 0) return;
      await this.sendAction(like.action, like.params, evt);
      return;
    }

    const slot: CommunityRule | undefined =
      evt.event === "follow"
        ? this.communityRules.follow
        : evt.event === "share"
          ? this.communityRules.share
          : evt.event === "subscribe"
            ? this.communityRules.superfan
            : undefined;

    if (slot && slot.enabled && slot.action) {
      await this.sendAction(slot.action, slot.params, evt);
    }
  }

  private async sendAction(
    action: string,
    params: Record<string, number | string | boolean>,
    evt: LiveEvent,
  ) {
    const nameTag = evt.nickname ?? evt.username;
    const isArena = isArenaAction(action);

    // Contrato: en arena_* la app DEBE mandar nameTag y coins.
    const opts: { nameTag?: string; notify?: string } = {};
    if (isArena || this.modBridge.getAction(action)?.supportsNameTag) {
      opts.nameTag = nameTag;
    }

    await this.modBridge.sendCommand(action, params, opts);
  }

  private matches(rule: MappingRule, evt: LiveEvent): boolean {
    if (rule.when.event !== evt.event) return false;
    if (rule.when.giftId !== undefined && evt.giftId !== rule.when.giftId) return false;
    if (rule.when.minCoins !== undefined && (evt.coins ?? 0) < rule.when.minCoins) return false;
    if (rule.when.command !== undefined) {
      if (evt.event !== "comment") return false;
      if (!evt.text?.trim().toLowerCase().startsWith(rule.when.command.toLowerCase())) return false;
    }
    return true;
  }
}
