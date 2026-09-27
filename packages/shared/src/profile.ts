import { z } from "zod";
import { MappingRuleSchema } from "./mapping-rule.js";

/**
 * Perfiles de configuración de reglas de mapeo (ADR 0002). Concepto UI↔sidecar:
 * un mod puede tener varios perfiles nombrados, cada uno con su propio
 * `MappingRule[]`, y solo uno activo a la vez. NO forma parte del protocolo del
 * mod (mod-protocol.ts).
 */

/** Un perfil completo (como se persiste en profiles.json). */
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.array(MappingRuleSchema),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Forma en disco del archivo `profiles.json`. */
export const ProfilesFileSchema = z.object({
  profiles: z.array(ProfileSchema),
  activeProfileId: z.string(),
});
export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;

/** Metadato de perfil que viaja por WS (las reglas no se duplican: van por
 * el canal `mapping-rules`). */
export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  ruleCount: z.number(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

/**
 * Canal WS `profiles` (UI ↔ sidecar). Requests del cliente:
 *  - `create {name}`     crear perfil vacío.
 *  - `duplicate {id}`    duplicar perfil (copia profunda de sus reglas).
 *  - `rename {id,name}`  renombrar.
 *  - `delete {id}`       borrar (se rechaza si es el último).
 *  - `set-active {id}`   marcar activo.
 * Responses del sidecar:
 *  - `state {profiles, activeProfileId}` (broadcast en cada cambio y a clientes
 *    que conectan tarde).
 *  - `error {message}` (solo al socket que pidió, para rechazos).
 */
export const ProfilesMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), name: z.string() }),
  z.object({ kind: z.literal("duplicate"), id: z.string() }),
  z.object({ kind: z.literal("rename"), id: z.string(), name: z.string() }),
  z.object({ kind: z.literal("delete"), id: z.string() }),
  z.object({ kind: z.literal("set-active"), id: z.string() }),
  z.object({
    kind: z.literal("state"),
    profiles: z.array(ProfileSummarySchema),
    activeProfileId: z.string(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ProfilesMessage = z.infer<typeof ProfilesMessageSchema>;
