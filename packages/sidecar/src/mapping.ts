import type { LiveEvent, MappingRule } from "@streamtok/shared";
import { isArenaAction } from "@streamtok/shared";
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

      const nameTag = evt.nickname ?? evt.username;
      const isArena = isArenaAction(rule.action);

      // Contrato: en arena_* la app DEBE mandar nameTag y coins.
      const opts: { nameTag?: string; notify?: string } = {};
      if (isArena || this.modBridge.getAction(rule.action)?.supportsNameTag) {
        opts.nameTag = nameTag;
      }

      await this.modBridge.sendCommand(rule.action, params, opts);
    }
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
