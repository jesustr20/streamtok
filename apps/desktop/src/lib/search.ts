/** Minúsculas y sin tildes, para que "camion" encuentre "Camión". */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** `true` si `text` contiene `query` (sin distinguir mayúsculas ni tildes). Una
 * búsqueda vacía coincide con todo. */
export function matchesQuery(text: string, query: string): boolean {
  const q = normalizeText(query);
  return q === "" || normalizeText(text).includes(q);
}
