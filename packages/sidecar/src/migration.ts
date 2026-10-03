import { nanoid } from "nanoid";
import {
  CommunityRulesSchema,
  MappingRuleSchema,
  ProfileSchema,
  ProfilesFileSchema,
  type Accion,
  type CommunityRuleKind,
  type CommunityRules,
  type Evento,
  type MappingRule,
  type Profile,
  type ProfilesFile,
} from "@streamtok/shared";

/**
 * Migración sin pérdida de datos desde el modelo viejo (MappingRule /
 * CommunityRule, ADR 0001–0003) al genérico de Acciones/Eventos (ADR 0004).
 * Idempotente: si los datos ya están en la forma nueva, se devuelven tal cual.
 * No usa zod directamente (el sidecar no lo tiene como dependencia); reusa los
 * schemas legacy importados de `@streamtok/shared`.
 */

function makeAccion(
  modActionId: string,
  params: Record<string, number | string | boolean>,
  nombre: string,
): Accion {
  return {
    id: nanoid(),
    nombre,
    descripcion: "",
    duracionSeg: 0,
    puntos: 0,
    pantalla: null,
    media: { animacion: false, imagen: false, sonido: false, video: false },
    comandos: [{ modActionId, params }],
    repetirConComboDeRegalos: false,
  };
}

/** Traduce el `when` de una MappingRule al mejor `porque` posible. */
function whenToEvento(when: MappingRule["when"], accionesIds: string[]): Evento {
  const base = {
    id: nanoid(),
    activo: true,
    quien: "todos" as const,
    accionesTodas: accionesIds,
    accionesAleatorias: [],
  };

  switch (when.event) {
    case "gift":
      if (when.giftId !== undefined) {
        return { ...base, porque: "regaloEspecifico", giftId: String(when.giftId) };
      }
      return {
        ...base,
        porque: "regaloValorMinimo",
        valorMinimoMonedas: when.minCoins !== undefined ? when.minCoins : 1,
      };
    case "like":
      return { ...base, porque: "likes", cantidadMinimaLikes: 1 };
    case "comment":
      return when.command
        ? { ...base, porque: "comando", comando: when.command }
        : { ...base, porque: "chat" };
    case "follow":
      return { ...base, porque: "seguir" };
    case "share":
      return { ...base, porque: "compartir" };
    case "join":
      return { ...base, porque: "unirse" };
    case "subscribe":
      return { ...base, porque: "suscribirse" };
    default:
      // "emote" (y cualquier valor futuro) no existía en las MappingRule
      // legacy; imposible en datos viejos. Fallback inocuo para que la
      // migración siga siendo exhaustiva (issue #23).
      return { ...base, porque: "chat" };
  }
}

/** Una MappingRule → 1 Acción + 1 Evento. */
export function mappingRuleToAccionEvento(rule: MappingRule): {
  accion: Accion;
  evento: Evento;
} {
  const accion = makeAccion(rule.action, rule.params, `Acción migrada (${rule.when.event})`);
  const evento = whenToEvento(rule.when, [accion.id]);
  return { accion, evento };
}

/** Convierte un array plano de MappingRule (mapping-rules.json viejo). */
export function migrateLegacyRules(
  rules: MappingRule[],
): { acciones: Accion[]; eventos: Evento[] } {
  const acciones: Accion[] = [];
  const eventos: Evento[] = [];
  for (const rule of rules) {
    const { accion, evento } = mappingRuleToAccionEvento(rule);
    acciones.push(accion);
    eventos.push(evento);
  }
  return { acciones, eventos };
}

const COMMUNITY_PORQUE: Record<CommunityRuleKind, Evento["porque"]> = {
  follow: "seguir",
  share: "compartir",
  superfan: "suscribirse",
  like: "likes",
};

const COMMUNITY_NAMES: Record<CommunityRuleKind, string> = {
  follow: "Seguir",
  share: "Compartir",
  superfan: "SuperFan",
  like: "Likes",
};

/** Las 4 reglas de comunidad → 1 Acción + 1 Evento por slot configurado. */
export function communityRulesToAccionesEventos(
  cr: CommunityRules,
): { acciones: Accion[]; eventos: Evento[] } {
  const acciones: Accion[] = [];
  const eventos: Evento[] = [];

  const slots: Array<{ kind: CommunityRuleKind; slot: CommunityRules[CommunityRuleKind] }> = [
    { kind: "follow", slot: cr.follow },
    { kind: "share", slot: cr.share },
    { kind: "superfan", slot: cr.superfan },
    { kind: "like", slot: cr.like },
  ];

  for (const { kind, slot } of slots) {
    if (!slot.action) continue; // sin acción asignada → no se migra
    const accion = makeAccion(slot.action, slot.params, `Comunidad · ${COMMUNITY_NAMES[kind]}`);
    const evento: Evento = {
      id: nanoid(),
      activo: slot.enabled,
      quien: "todos",
      porque: COMMUNITY_PORQUE[kind],
      ...(kind === "like" ? { cantidadMinimaLikes: slot.everyNLikes ?? 1 } : {}),
      accionesTodas: [accion.id],
      accionesAleatorias: [],
    };
    acciones.push(accion);
    eventos.push(evento);
  }

  return { acciones, eventos };
}

/** Parsea un perfil viejo (ADR 0002/0003) sin zod. */
function parseLegacyProfile(raw: unknown): {
  id: string;
  name: string;
  rules: MappingRule[] | null;
  communityRules: CommunityRules | null;
} | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;

  let rules: MappingRule[] | null = null;
  if (obj.rules !== undefined) {
    const parsed = MappingRuleSchema.array().safeParse(obj.rules);
    if (!parsed.success) return null;
    rules = parsed.data;
  }

  let communityRules: CommunityRules | null = null;
  if (obj.communityRules !== undefined) {
    const parsed = CommunityRulesSchema.safeParse(obj.communityRules);
    if (!parsed.success) return null;
    communityRules = parsed.data;
  }

  return { id: obj.id, name: obj.name, rules, communityRules };
}

/** Un perfil crudo (nuevo o viejo) → Profile nuevo, o null si es irreconocible. */
export function migrateProfile(raw: unknown): Profile | null {
  const parsedNew = ProfileSchema.safeParse(raw);
  if (parsedNew.success) return parsedNew.data;

  const legacy = parseLegacyProfile(raw);
  if (!legacy) return null;

  const acciones: Accion[] = [];
  const eventos: Evento[] = [];

  if (legacy.rules) {
    const migrated = migrateLegacyRules(legacy.rules);
    acciones.push(...migrated.acciones);
    eventos.push(...migrated.eventos);
  }
  if (legacy.communityRules) {
    const migrated = communityRulesToAccionesEventos(legacy.communityRules);
    acciones.push(...migrated.acciones);
    eventos.push(...migrated.eventos);
  }

  return { id: legacy.id, name: legacy.name, acciones, eventos };
}

/** Un `profiles.json` crudo (nuevo o viejo) → ProfilesFile, o null. */
export function migrateProfilesFile(raw: unknown): ProfilesFile | null {
  const parsedNew = ProfilesFileSchema.safeParse(raw);
  if (parsedNew.success) return parsedNew.data;

  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.profiles) || typeof obj.activeProfileId !== "string") return null;

  const profiles: Profile[] = [];
  for (const p of obj.profiles) {
    const migrated = migrateProfile(p);
    if (!migrated) return null;
    profiles.push(migrated);
  }

  return { profiles, activeProfileId: obj.activeProfileId };
}
