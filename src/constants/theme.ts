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
    // The faintest text that still reads: 5.0:1 on a card, 4.6:1 on the
    // page. It was #98A0AF, 2.6:1 -- every subtitle ("gets back", "Vinod ·
    // 4 ways") and every inactive tab label was below the 4.5 small text
    // needs.
    textTertiary: '#697080',

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

    // Money coming to you, as text. Deeper than primary (#0E9A6C, 3.6:1 on
    // white): a "+₹234.15" is small text, and needs 4.5. Primary stays the
    // fill colour -- buttons, the active tab, the Add disc.
    positive: '#087A55',
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

    // One brand colour, used on almost everything that matters, the way the
    // big payment apps do: green means Roomly or "do something", red means
    // only "you owe", and everything else stays neutral -- so the green
    // always has full contrast against what's around it.

    // Brand green as ink: icons and small text on white or the page (4.8:1).
    brandInk: '#087A55',

    // Home's big balance card, in brand green. Deeper than primary on
    // purpose: on #087F5B the pale label measured 4.41:1, under the 4.5 a
    // small label needs; here white is 6.5:1 and the label 5.8:1. On a green
    // card the amount can't be green, so it is white either way: a pale red
    // read as a washed-out pink. Its + or − and the chip below say which way.
    balanceCard: '#066B4C',
    balanceEdge: '#066B4C',
    onBalance: '#FFFFFF',
    onBalanceMuted: '#D1FAE5',
    balanceRing: 'rgba(255,255,255,0.12)',
    balanceRule: 'rgba(255,255,255,0.2)',
    balancePositive: '#FFFFFF',
    balanceNegative: '#FFFFFF',
    // The chip under the amount, the shape that says the direction at a
    // glance: pale mint "You get back", pale coral "You pay". Solid pale
    // fills, so the dark ink reads on them whatever the card behind.
    balanceIn: '#D1FAE5',
    onBalanceIn: '#065F46',
    balanceOut: '#FDE4DE',
    onBalanceOut: '#9A2F1C',

    // Home's two small cards, two greens so they stay on-brand yet read as
    // different things: mint for the household, a soft lime for you. Each
    // carries its own darker ink -- muted labels 5.4:1 and 6.5:1, amounts
    // 12:1+ -- and a white icon tile.
    houseCard: '#DDF3E8',
    houseEdge: '#C9EBDA',
    houseInk: '#06301F',
    houseMuted: '#2F6B56',
    houseIcon: '#087A55',
    houseChip: '#FFFFFF',
    houseRule: 'rgba(6,48,31,0.12)',
    shareCard: '#EEF7D9',
    shareEdge: '#DFEDBF',
    shareInk: '#1F2A06',
    shareMuted: '#4A5E1A',
    shareIcon: '#4D6B0A',
    shareChip: '#FFFFFF',
    shareRule: 'rgba(31,42,6,0.12)',

    // The floating tab bar's drawn shadow, two layers of this.
    barShadow: 'rgba(16,24,40,0.06)',

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
    // 5.0:1 on a card; #5E6573 was 3.1:1.
    textTertiary: '#7F8796',

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

    brandInk: '#3ECF8E',

    // A dark green in dark mode: bright green on a near-black page would
    // glare. The amount is white either way, as in light mode: the light red
    // read as pink on this green, and the label above says which way it is.
    balanceCard: '#0F3D2E',
    balanceEdge: '#1B5A44',
    onBalance: '#FFFFFF',
    onBalanceMuted: '#A7F3D0',
    balanceRing: 'rgba(255,255,255,0.08)',
    balanceRule: 'rgba(255,255,255,0.16)',
    balancePositive: '#FFFFFF',
    balanceNegative: '#FFFFFF',
    // A step deeper than light mode's, so the chips don't glare on the dark
    // green card.
    balanceIn: '#A7F3D0',
    onBalanceIn: '#064E3B',
    balanceOut: '#FBCFC4',
    onBalanceOut: '#7F2414',

    // Deep green and deep olive, with pale ink (12:1+) and brighter icons.
    houseCard: '#10281F',
    houseEdge: '#1B4A38',
    houseInk: '#ECFDF5',
    houseMuted: '#A7F3D0',
    houseIcon: '#3ECF8E',
    houseChip: '#1B4A38',
    houseRule: 'rgba(167,243,208,0.16)',
    shareCard: '#1D2410',
    shareEdge: '#33401A',
    shareInk: '#F7FEE7',
    shareMuted: '#D6EFA3',
    shareIcon: '#BEF264',
    shareChip: '#33401A',
    shareRule: 'rgba(214,239,163,0.16)',

    barShadow: 'rgba(0,0,0,0.45)',

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
/**
 * Three weights, and no bold. Regular (400) for reading -- body, captions,
 * hints. Medium (500) for what a list is scanned by: names and amounts.
 * Semibold (600) only for titles, section headings, the big numbers and
 * buttons. Body used to be medium and headings bold, which made every line on
 * every screen heavy and nothing stand out.
 */
export const Type = {
  /** The single biggest number on a screen. Never bigger than this. */
  display: { fontSize: 32, fontWeight: '600', letterSpacing: -1.1, lineHeight: 38 },
  title: { fontSize: 20, fontWeight: '600', letterSpacing: -0.4, lineHeight: 26 },
  headline: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', letterSpacing: -0.1, lineHeight: 21 },
  amount: { fontSize: 15, fontWeight: '500', letterSpacing: -0.2, lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  micro: { fontSize: 11.5, fontWeight: '400', lineHeight: 16 },
  /** Section headers. Small, spaced, quiet — never bold black. */
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.7, lineHeight: 15 },
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

/** The floating tab bar's measurements, shared by the bar and the screens under it. */
export const TabBar = {
  /** The rounded body the tabs sit in. */
  body: 68,
  /** How far the hump over the Add button rises above the body. */
  hump: 8,
  /** Gap between the bar and the screen's sides and bottom inset. */
  margin: 12,
} as const;

/**
 * Bottom padding for a tab screen's scroll content, so its last row stops just
 * above the floating bar instead of under it. The screens' SafeAreaView already
 * pads for the system inset, so this only clears the bar, plus a little air.
 * (It was a flat 130, sized for the old floating + button, and left a band of
 * empty page above the bar.)
 */
export const TabBarClearance = TabBar.margin + TabBar.body + TabBar.hump + 12;

/**
 * The widest the app is ever drawn. Every screen is laid out for a phone, so
 * on a tablet, an unfolded foldable or a landscape window the whole app sits
 * in a centred column this wide rather than stretching rows, cards and the
 * tab bar across the full screen. A big phone (~430) is untouched.
 */
export const MaxContentWidth = 640;
