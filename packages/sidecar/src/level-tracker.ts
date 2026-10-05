/**
 * Detecta subidas de nivel (ADR 0007). TikTok no manda un aviso de "subió de
 * nivel": solo repite el nivel actual del usuario en las insignias de cada
 * mensaje. Este tracker recuerda el último nivel visto por usuario y, cuando
 * uno aumenta, devuelve la subida.
 *
 * - La primera vez que se ve a un usuario NO cuenta como subida (no hay nivel
 *   anterior con el que comparar).
 * - Un mensaje sin nivel no borra lo recordado (ej. un Like sin insignias).
 * - Una bajada solo actualiza el nivel recordado.
 */
export type LevelChange = {
  kind: "donorLevelUp" | "fanLevelUp";
  previousLevel: number;
  newLevel: number;
};

type Seen = { userLevel?: number; fanLevel?: number };

function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

export class LevelTracker {
  private readonly seen = new Map<string, Seen>();

  observe(username: string, levels: { userLevel?: number; fanLevel?: number }): LevelChange[] {
    const key = normalizeHandle(username);
    const prev = this.seen.get(key) ?? {};
    const next: Seen = { ...prev };
    const changes: LevelChange[] = [];

    if (levels.userLevel !== undefined) {
      if (prev.userLevel !== undefined && levels.userLevel > prev.userLevel) {
        changes.push({ kind: "donorLevelUp", previousLevel: prev.userLevel, newLevel: levels.userLevel });
      }
      next.userLevel = levels.userLevel;
    }
    if (levels.fanLevel !== undefined) {
      if (prev.fanLevel !== undefined && levels.fanLevel > prev.fanLevel) {
        changes.push({ kind: "fanLevelUp", previousLevel: prev.fanLevel, newLevel: levels.fanLevel });
      }
      next.fanLevel = levels.fanLevel;
    }

    this.seen.set(key, next);
    return changes;
  }

  /** Olvida a todos los usuarios (nueva sesión de LIVE). */
  reset(): void {
    this.seen.clear();
  }
}
