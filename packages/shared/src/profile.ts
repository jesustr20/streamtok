import { z } from "zod";
import { AccionSchema } from "./action.js";
import { EventoSchema } from "./event.js";

/**
 * Perfiles de configuración (ADR 0002, ADR 0004). Concepto UI↔sidecar:
 * un mod puede tener varios perfiles nombrados, cada uno con sus propias
 * Acciones y Eventos, y solo uno activo a la vez. NO forma parte del protocolo
 * del mod (mod-protocol.ts).
 */

/** Un perfil completo (como se persiste en profiles.json). */
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  acciones: z.array(AccionSchema),
  eventos: z.array(EventoSchema),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Forma en disco del archivo `profiles.json`. */
export const ProfilesFileSchema = z.object({
  profiles: z.array(ProfileSchema),
  activeProfileId: z.string(),
});
export type ProfilesFile = z.infer<typeof ProfilesFileSchema>;

/** Metadato de perfil que viaja por WS (las acciones/eventos no se duplican:
 * van por los canales `acciones`/`eventos`). */
export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  eventoCount: z.number(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

/**
 * Canal WS `profiles` (UI ↔ sidecar). Requests del cliente:
 *  - `create {name}`     crear perfil vacío.
 *  - `duplicate {id}`    duplicar perfil (copia profunda de sus acciones/eventos).
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
