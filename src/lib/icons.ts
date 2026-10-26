/**
 * Category icons live here, not in the database.
 *
 * Postgres holds a plain ASCII slug ('rent', 'milk'). Emoji only ever exist
 * in this file, which Metro reads as UTF-8 — so no SQL file, clipboard, or
 * terminal ever has to carry a multi-byte character. The first attempt stored
 * emoji in the database and they arrived as "ðŸ  Rent".
 */
const ICONS: Record<string, string> = {
  // home & bills
  rent: '🏠',
  electricity: '💡',
  water: '🚰',
  wifi: '📶',
  phone: '📱',
  gas: '🔥',
  maid: '🧹',
  repairs: '🔧',
  furniture: '🛋️',
  subscription: '📺',

  // food
  groceries: '🛒',
  milk: '🥛',
  vegetables: '🥬',
  fruit: '🍎',
  dining: '🍽️',
  snacks: '🍪',
  water_can: '💧',
  cook: '👨‍🍳',

  // day to day
  transport: '🛺',
  fuel: '⛽',
  supplies: '🧴',
  laundry: '🧺',
  medical: '💊',
  gym: '🏋️',
  pets: '🐾',
  party: '🎉',
  gifts: '🎁',
  misc: '📦',
};

/** Offered in the icon picker, in a deliberate order rather than alphabetical. */
export const ICON_SLUGS = Object.keys(ICONS);

export function iconFor(slug: string | null | undefined): string {
  if (!slug) return ICONS.misc;
  return ICONS[slug] ?? ICONS.misc;
}

/**
 * The same slugs as thin line icons (MaterialCommunityIcons names), for places
 * that sit beside the line-icon tiles on Home. Emoji draw differently on every
 * phone and in full colour; these take the category's chart colour instead.
 */
const LINE_ICONS: Record<string, string> = {
  rent: 'home-outline',
  electricity: 'lightning-bolt-outline',
  water: 'water-outline',
  wifi: 'wifi',
  phone: 'cellphone',
  gas: 'fire',
  maid: 'broom',
  repairs: 'wrench-outline',
  furniture: 'sofa-outline',
  subscription: 'television-classic',

  groceries: 'cart-outline',
  milk: 'cup-outline',
  vegetables: 'carrot',
  fruit: 'food-apple-outline',
  dining: 'silverware-fork-knife',
  snacks: 'cookie-outline',
  water_can: 'cup-water',
  cook: 'chef-hat',

  transport: 'rickshaw',
  fuel: 'gas-station-outline',
  supplies: 'spray-bottle',
  laundry: 'washing-machine',
  medical: 'pill',
  gym: 'dumbbell',
  pets: 'paw-outline',
  party: 'party-popper',
  gifts: 'gift-outline',
  misc: 'package-variant-closed',
};

export function lineIconFor(slug: string | null | undefined): string {
  if (!slug) return LINE_ICONS.misc;
  return LINE_ICONS[slug] ?? LINE_ICONS.misc;
}
