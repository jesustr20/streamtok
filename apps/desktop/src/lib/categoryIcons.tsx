import type { ReactElement, ReactNode } from "react";

type IconProps = { size?: number };

/** Base común: stroke sin relleno, viewBox 24×24, hereda el color del texto. */
function IconSvg({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** vehicle — silueta simple de auto visto de perfil. */
export function VehicleIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M4 16l1.5-4.5A2 2 0 0 1 7.4 10h9.2a2 2 0 0 1 1.9 1.5L20 16" />
      <path d="M4 16h16" />
      <circle cx="8" cy="16.5" r="1.5" />
      <circle cx="16" cy="16.5" r="1.5" />
    </IconSvg>
  );
}

/** weapon — mira/crosshair (círculo con cruz). */
export function WeaponIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
    </IconSvg>
  );
}

/** npc — dos siluetas de persona lado a lado (grupo). */
export function NpcIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M15 3.13a4 4 0 0 1 0 7.75" />
    </IconSvg>
  );
}

/** player — silueta de persona con un foco/círculo alrededor. */
export function PlayerIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M6 20c0-3.3 2.7-5 6-5s6 1.7 6 5" />
    </IconSvg>
  );
}

/** character — máscara de teatro simple. */
export function CharacterIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M12 3c2.8 0 5 2.4 5 5.4V15c0 3-2.2 5-5 5s-5-2-5-5V8.4C7 5.4 9.2 3 12 3z" />
      <path d="M10 9.5h.01" />
      <path d="M14 9.5h.01" />
      <path d="M10 13.5c.6.7 1.3 1 2 1s1.4-.3 2-1" />
    </IconSvg>
  );
}

/** world — globo. */
export function WorldIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <ellipse cx="12" cy="12" rx="4" ry="8" />
    </IconSvg>
  );
}

/** spectacle — estrella / destello (sparkle). */
export function SpectacleIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </IconSvg>
  );
}

/** chiliad — montaña con pico. */
export function ChiliadIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M3 19l5-9 4 6 3-4 6 7H3z" />
    </IconSvg>
  );
}

/** arena — dos espadas cruzadas. */
export function ArenaIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M4 4l16 16" />
      <path d="M20 4L4 20" />
      <path d="M4 4l-2.5 2.5" />
      <path d="M20 4l2.5 2.5" />
    </IconSvg>
  );
}

/** parkour — flecha subiendo en diagonal. */
export function ParkourIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M5 19L19 5" />
      <path d="M10 5h9v9" />
    </IconSvg>
  );
}

/** race — bandera de meta (cuadros). */
export function RaceIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <path d="M5 21V4" />
      <path d="M5 4h14l-2.5 4L19 12H5" />
      <path d="M9 4v8" />
      <path d="M13 4v8" />
    </IconSvg>
  );
}

/** other — tres puntos horizontales (ellipsis). */
export function OtherIcon({ size }: IconProps) {
  return (
    <IconSvg size={size}>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconSvg>
  );
}

export type CategoryIconComponent = (props: IconProps) => ReactElement;

const ICONS: Record<string, CategoryIconComponent> = {
  vehicle: VehicleIcon,
  weapon: WeaponIcon,
  npc: NpcIcon,
  player: PlayerIcon,
  character: CharacterIcon,
  world: WorldIcon,
  spectacle: SpectacleIcon,
  chiliad: ChiliadIcon,
  arena: ArenaIcon,
  parkour: ParkourIcon,
  race: RaceIcon,
  other: OtherIcon,
};

/** Devuelve el ícono de la categoría. Usa el fallback `other` SOLO cuando la
 * categoría no viene (undefined/null/vacía) o no matchea ninguna de las 12
 * conocidas; nunca devuelve un ícono "fijo" para categorías válidas. */
export function getCategoryIcon(category: string | null | undefined): CategoryIconComponent {
  if (!category) return OtherIcon;
  return ICONS[category] ?? OtherIcon;
}
