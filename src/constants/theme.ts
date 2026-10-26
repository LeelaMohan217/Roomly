import '@/global.css';

import { Platform, type TextStyle } from 'react-native';

/**
 * Restraint is what reads as premium.
 *
 * The earlier pass shouted: a 44px balance, saturated mint fills, heavy
 * borders. Reference-quality fintech UI does the opposite — a moderate
 * headline number, one deep colour used sparingly, hairline separators, and
 * most of the page given over to quiet secondary text. Hierarchy comes from
 * weight and colour, not size.
 */
export const Colors = {
  light: {
    text: '#0C0E12',
    textSecondary: '#646B7A',
    textTertiary: '#98A0AF',

    background: '#F6F7F9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#EFF1F5',
    backgroundSunken: '#EBEDF1',

    border: '#E6E9EF',
    borderStrong: '#D2D7E0',

    primary: '#0E9A6C',
    primarySoft: '#E7F5EF',
    onPrimary: '#FFFFFF',

    // Status colours. Each one means the same thing on every screen: green is
    // done or good, red is failed or destructive, amber is "careful", blue is
    // just information. The `on*` colour is the text on a filled button.
    success: '#0E9A6C',
    successSoft: '#E7F5EF',
    onSuccess: '#FFFFFF',
    danger: '#DC2626',
    dangerSoft: '#FDEDED',
    onDanger: '#FFFFFF',
    warning: '#B45309',
    warningSoft: '#FDF3E4',
    onWarning: '#FFFFFF',
    info: '#2563EB',
    infoSoft: '#EAF1FE',
    onInfo: '#FFFFFF',

    positive: '#0E9A6C',
    negative: '#DC2626',

    // The balance card. In LIGHT mode it is a soft tint with dark green ink,
    // not a dark block: a saturated dark card on a pale page reads as a hole
    // punched in the screen. Every lighter green that keeps WHITE text fails
    // the muted label (1.99:1 measured, against a 4.5 threshold), so the ink
    // inverts instead -- 12.90:1 headline, 5.57:1 muted.
    heroFrom: '#E7F5EF',
    heroTo: '#D6EDE2',
    onHero: '#06301F',
    onHeroMuted: '#2F6B56',
    heroChip: 'rgba(6,48,31,0.08)',
    heroRule: 'rgba(6,48,31,0.12)',
    heroAccent: '#096647',
    heroUp: '#7A4E00',

    chart1: '#0E9A6C',
    chart2: '#3B82F6',
    chart3: '#F59E0B',
    chart4: '#8B5CF6',
    chart5: '#EC4899',
    chart6: '#14B8A6',
    chartTrack: '#E9ECF1',
  },
  dark: {
    text: '#ECEFF4',
    textSecondary: '#8C93A1',
    textTertiary: '#5E6573',

    background: '#0B0C10',
    backgroundElement: '#14161B',
    backgroundSelected: '#1C1F26',
    backgroundSunken: '#101216',

    border: '#20232B',
    borderStrong: '#2C3038',

    primary: '#3ECF8E',
    primarySoft: '#10281F',
    onPrimary: '#04231A',

    // Lifted for dark mode, so filled buttons carry DARK text instead of white.
    success: '#3ECF8E',
    successSoft: '#10281F',
    onSuccess: '#04231A',
    danger: '#F26D6D',
    dangerSoft: '#291517',
    onDanger: '#2B0A0A',
    warning: '#F0B23C',
    warningSoft: '#2A2011',
    onWarning: '#2A1B00',
    info: '#60A5FA',
    infoSoft: '#132036',
    onInfo: '#071A33',

    positive: '#3ECF8E',
    negative: '#F26D6D',

    // Deep green on near-black: the look this app was designed around, and the
    // reason the tokens below exist rather than hardcoded whites in the screen.
    heroFrom: '#14523E',
    heroTo: '#0C2C22',
    onHero: '#FFFFFF',
    onHeroMuted: 'rgba(255,255,255,0.62)',
    heroChip: 'rgba(255,255,255,0.14)',
    heroRule: 'rgba(255,255,255,0.18)',
    heroAccent: '#6EE7B7',
    heroUp: '#FCD34D',

    chart1: '#3ECF8E',
    chart2: '#60A5FA',
    chart3: '#FBBF24',
    chart4: '#A78BFA',
    chart5: '#F472B6',
    chart6: '#2DD4BF',
    chartTrack: '#1C1F26',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * One type scale, used everywhere. Ad-hoc fontSize values are the main reason
 * a screen looks assembled rather than designed.
 */
export const Type = {
  /** The single biggest number on a screen. Never bigger than this. */
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -1.1, lineHeight: 38 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, lineHeight: 26 },
  headline: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '500', letterSpacing: -0.1, lineHeight: 21 },
  amount: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  micro: { fontSize: 11.5, fontWeight: '500', lineHeight: 16 },
  /** Section headers. Small, spaced, quiet — never bold black. */
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, lineHeight: 15 },
} satisfies Record<string, TextStyle>;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Android needs `elevation`, iOS the shadow* family, web boxShadow. Passing
 * all three is the only way to get one consistent result.
 */
export const Elevation = {
  card: Platform.select({
    // 1 was imperceptible, which is most of why light mode read as flat.
    android: { elevation: 2 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
    },
  }),
  raised: Platform.select({
    android: { elevation: 6 },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
  }),
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/** Deterministic avatar colour from a member id, so the same person is the
 *  same colour on every device without storing anything. Muted pairs — a wall
 *  of neon circles is the fastest way to look cheap. */
export const AVATAR_COLORS = [
  ['#4F7DF0', '#3355C4'],
  ['#12A594', '#0B7A6D'],
  ['#E0862C', '#B4661A'],
  ['#8B6DE0', '#6544BC'],
  ['#D9557F', '#AE3860'],
  ['#3A9E6E', '#277A53'],
] as const;

export function avatarColors(seed: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** The gradient default. A member row stores this until someone picks. */
export const DEFAULT_AVATAR_COLOR = '#888888';

/**
 * The pair to actually paint with: a colour the member chose if there is one,
 * otherwise the deterministic one derived from their id. Only the first hex of
 * each pair is stored, so the gradient survives a round trip.
 */
export function avatarPairFor(
  stored: string | null | undefined,
  seed: string
): readonly [string, string] {
  if (stored && stored !== DEFAULT_AVATAR_COLOR) {
    const hit = AVATAR_COLORS.find((p) => p[0].toLowerCase() === stored.toLowerCase());
    if (hit) return hit;
  }
  return avatarColors(seed);
}
