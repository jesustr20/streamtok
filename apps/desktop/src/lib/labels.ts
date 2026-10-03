import type { Evento, EventoPorque, EventoQuien } from "@streamtok/shared";

export const QUIEN_LABELS: Record<EventoQuien, string> = {
  todos: "Todos",
  seguidor: "Cualquier Seguidor",
  suscriptor: "Cualquier Suscriptor",
  moderador: "Cualquier Moderador",
  usuarioEspecifico: "Un Usuario Específico",
  donanteTop: "Principal Donante",
};

export const QUIEN_OPTIONS: { value: EventoQuien; label: string }[] = [
  { value: "todos", label: QUIEN_LABELS.todos },
  { value: "seguidor", label: QUIEN_LABELS.seguidor },
  { value: "suscriptor", label: QUIEN_LABELS.suscriptor },
  { value: "moderador", label: QUIEN_LABELS.moderador },
  { value: "donanteTop", label: QUIEN_LABELS.donanteTop },
  { value: "usuarioEspecifico", label: QUIEN_LABELS.usuarioEspecifico },
];

export const PORQUE_LABELS: Record<EventoPorque, string> = {
  unirse: "Unirse",
  primeraActividad: "Primera actividad",
  compartir: "Compartir",
  seguir: "Seguir",
  suscribirse: "Suscribirse",
  likes: "Enviando likes",
  chat: "Comentando en el chat",
  comando: "Comentando un comando",
  regaloValorMinimo: "Enviando un regalo con valor mínimo",
  regaloEspecifico: "Enviando un regalo específico",
  emoteSuscriptor: "Enviando un emote de suscriptor",
  stickerFanClub: "Enviando un sticker del club de fans",
  compraTiktokShop: "Comprar un producto en TikTok Shop",
};

export const PORQUE_OPTIONS: { value: EventoPorque; label: string }[] = [
  { value: "unirse", label: PORQUE_LABELS.unirse },
  { value: "primeraActividad", label: PORQUE_LABELS.primeraActividad },
  { value: "compartir", label: PORQUE_LABELS.compartir },
  { value: "seguir", label: PORQUE_LABELS.seguir },
  { value: "suscribirse", label: PORQUE_LABELS.suscribirse },
  { value: "likes", label: PORQUE_LABELS.likes },
  { value: "chat", label: PORQUE_LABELS.chat },
  { value: "comando", label: PORQUE_LABELS.comando },
  { value: "regaloValorMinimo", label: PORQUE_LABELS.regaloValorMinimo },
  { value: "regaloEspecifico", label: PORQUE_LABELS.regaloEspecifico },
  { value: "emoteSuscriptor", label: PORQUE_LABELS.emoteSuscriptor },
  { value: "stickerFanClub", label: PORQUE_LABELS.stickerFanClub },
  { value: "compraTiktokShop", label: PORQUE_LABELS.compraTiktokShop },
];

/**
 * Los dos `porque` que el motor todavía no puede detectar (ADR 0005). Son los
 * únicos que deben llevar la etiqueta "(próximamente)"; el resto (incluidos
 * regalo/emote/sticker, que funcionan extremo a extremo aunque su picker sea
 * texto libre) no la llevan.
 */
export const PROXIMAMENTE_PORQUE: ReadonlySet<EventoPorque> = new Set([
  "primeraActividad",
  "compraTiktokShop",
]);

/** Texto legible de la columna "Usuario" de un Evento. */
export function describeQuien(e: Evento): string {
  if (e.quien === "usuarioEspecifico") {
    return `${QUIEN_LABELS[e.quien]} (@${e.usuarioEspecifico ?? ""})`;
  }
  if (e.quien === "donanteTop") {
    return `${QUIEN_LABELS[e.quien]} (top ${e.numeroDonantesTop ?? 3})`;
  }
  return QUIEN_LABELS[e.quien];
}
