import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type {
  CommunityRule,
  CommunityRuleKind,
  CommunityRules,
  EventLogEntry,
  LiveEvent,
  MappingRule,
  ModAckPayload,
} from "@streamtok/shared";
import { defaultCommunityRules, isArenaAction } from "@streamtok/shared";
import { COMMUNITY_LABELS, EVENT_LABELS, reasonForCommandError } from "./event-log.js";
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
 *
 * Emite `"event-log"` (EventLogEntry) por cada decisión que toma al evaluar
 * un evento (regla/slot disparado, o descarte y por qué) — ver issue #17.
 */

export class MappingEngine extends EventEmitter {
  private communityRules: CommunityRules = defaultCommunityRules();
  /** Likes acumulados desde el último reset (ver ADR 0003: "cada N likes"). */
  private likeCount = 0;

  constructor(
    private modBridge: ModBridge,
    private rules: MappingRule[] = [],
  ) {
    super();
  }

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
    if (evt.event === "gift" && evt.repeatEnd === false) {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        reason: "gift-in-progress",
        message: "regalo en combo (se ignora hasta el fin del streak)",
      });
      return;
    }

    let matched = false;

    for (const rule of this.rules) {
      if (!this.matches(rule, evt)) continue;
      matched = true;

      const params = { ...rule.params };
      if (rule.passCoinsAsParam && typeof evt.coins === "number") {
        params[rule.passCoinsAsParam] = evt.coins;
      }

      const ack = await this.sendAction(rule.action, params, evt);
      this.emitCommandOutcome(ack, evt, { action: rule.action, ruleId: rule.id });
    }

    matched = (await this.handleCommunityEvent(evt)) || matched;

    if (!matched) {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        reason: "no-match",
        message: `sin regla para ${EVENT_LABELS[evt.event]}`,
      });
    }
  }

  private async handleCommunityEvent(evt: LiveEvent): Promise<boolean> {
    if (evt.event === "like") {
      const like = this.communityRules.like;
      if (!like.enabled || !like.action) return false;

      const n = like.everyNLikes ?? 1;
      this.likeCount += 1;
      if (this.likeCount % n !== 0) {
        this.emitEntry({
          status: "discarded",
          event: "like",
          reason: "like-threshold",
          communityKind: "like",
          action: like.action,
          message: `like acumulado (${this.likeCount % n}/${n})`,
        });
        return true;
      }

      const ack = await this.sendAction(like.action, like.params, evt);
      this.emitCommandOutcome(ack, evt, { action: like.action, communityKind: "like" });
      return true;
    }

    const kind: CommunityRuleKind | undefined =
      evt.event === "follow"
        ? "follow"
        : evt.event === "share"
          ? "share"
          : evt.event === "subscribe"
            ? "superfan"
            : undefined;

    if (!kind) return false;

    const slot: CommunityRule = this.communityRules[kind];
    if (!slot.enabled || !slot.action) return false;

    const ack = await this.sendAction(slot.action, slot.params, evt);
    this.emitCommandOutcome(ack, evt, { action: slot.action, communityKind: kind });
    return true;
  }

  private async sendAction(
    action: string,
    params: Record<string, number | string | boolean>,
    evt: LiveEvent,
  ): Promise<ModAckPayload> {
    const nameTag = evt.nickname ?? evt.username;
    const isArena = isArenaAction(action);

    // Contrato: en arena_* la app DEBE mandar nameTag y coins.
    const opts: { nameTag?: string; notify?: string } = {};
    if (isArena || this.modBridge.getAction(action)?.supportsNameTag) {
      opts.nameTag = nameTag;
    }

    return this.modBridge.sendCommand(action, params, opts);
  }

  private emitCommandOutcome(
    ack: ModAckPayload,
    evt: LiveEvent,
    ctx: { action: string; ruleId?: string; communityKind?: CommunityRuleKind },
  ) {
    if (ack.ok) {
      const label = ctx.communityKind
        ? COMMUNITY_LABELS[ctx.communityKind]
        : EVENT_LABELS[evt.event];
      this.emitEntry({
        status: "fired",
        event: evt.event,
        action: ctx.action,
        ruleId: ctx.ruleId,
        communityKind: ctx.communityKind,
        message: `${label} → ${ctx.action}`,
      });
    } else {
      this.emitEntry({
        status: "discarded",
        event: evt.event,
        action: ctx.action,
        ruleId: ctx.ruleId,
        communityKind: ctx.communityKind,
        reason: reasonForCommandError(ack.error),
        message: `no se pudo enviar ${ctx.action}: ${ack.error ?? "sin detalle"}`,
      });
    }
  }

  private emitEntry(entry: Omit<EventLogEntry, "id" | "at">) {
    this.emit("event-log", { id: nanoid(), at: Date.now(), ...entry } satisfies EventLogEntry);
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
