import type { IconName } from '@/components/ui/icon';

/**
 * Category icons live here, not in the database.
 *
 * Postgres holds a plain ASCII slug ('rent', 'milk'). The app draws each one
 * with a Lucide icon of the same name (components/ui/icon.tsx). It used to
 * draw emoji, which looked different on every phone and came out in full
 * colour beside the app's thin line icons; the slugs are unchanged, so every
 * category already saved keeps working.
 */

/** Offered in the icon picker, in a deliberate order rather than alphabetical. */
export const ICON_SLUGS = [
  // home & bills
  'rent',
  'electricity',
  'water',
  'wifi',
  'phone',
  'gas',
  'maid',
  'repairs',
  'furniture',
  'subscription',

  // food
  'groceries',
  'milk',
  'vegetables',
  'fruit',
  'dining',
  'water_can',
  'cook',

  // day to day
  'transport',
  'fuel',
  'supplies',
  'laundry',
  'medical',
  'gym',
  'pets',
  'party',
  'gifts',
  'misc',
] as const satisfies readonly IconName[];

export type CategorySlug = (typeof ICON_SLUGS)[number];

/** The icon for a category's stored slug; anything unknown is a parcel. */
export function categoryIcon(slug: string | null | undefined): IconName {
  return (ICON_SLUGS as readonly string[]).includes(slug ?? '') ? (slug as CategorySlug) : 'misc';
}

/**
 * Each category's colour: the icon is drawn in it, on a soft tint of it.
 *
 * Mid tones, so the icon reads on the light page and the dark one alike.
 * Neighbours in the picker get clearly different colours so a list of them
 * does not blur together. "misc", and anything unknown, is a quiet grey.
 */
const CATEGORY_COLORS: Record<CategorySlug, string> = {
  rent: '#6366F1',
  electricity: '#CA8A04',
  water: '#0EA5E9',
  wifi: '#8B5CF6',
  phone: '#2563EB',
  gas: '#EA580C',
  maid: '#0D9488',
  repairs: '#64748B',
  furniture: '#A16207',
  subscription: '#DB2777',

  groceries: '#16A34A',
  milk: '#3B82F6',
  vegetables: '#65A30D',
  fruit: '#E11D48',
  dining: '#E8762C',
  water_can: '#0891B2',
  cook: '#B45309',

  transport: '#4F46E5',
  fuel: '#DC2626',
  supplies: '#9333EA',
  laundry: '#0284C7',
  medical: '#E0484F',
  gym: '#0E9A8A',
  pets: '#92400E',
  party: '#C026D3',
  gifts: '#D97706',
  misc: '#7C8592',
};

export function categoryColor(slug: string | null | undefined): string {
  return CATEGORY_COLORS[categoryIcon(slug) as CategorySlug] ?? CATEGORY_COLORS.misc;
}

/** A colour as the soft tile behind its icon: the same colour, mostly see-through. */
export function tintOf(color: string): string {
  return `${color}24`;
}

/** A category's tile background. */
export function categoryTint(slug: string | null | undefined): string {
  return tintOf(categoryColor(slug));
}
