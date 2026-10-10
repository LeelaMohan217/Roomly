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
