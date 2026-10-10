import type { Paise } from './money';

/**
 * Deliberately minimal structural types rather than the Drizzle or Supabase
 * row types. This module is the domain core — it should not care whether the
 * data arrived from Postgres, local SQLite, or a test fixture.
 */
export type ResidentLike = { id: string; joinedOn: string; leftOn: string | null };
export type AwayLike = { memberId: string; startDate: string; endDate: string | null };
export type CategoryLike = { respectsAwayCalendar: boolean };

export type Split = { memberId: string; amountPaise: Paise };

/** Was this member in the house on this date? */
export function isPresent(memberId: string, date: string, away: AwayLike[]): boolean {
  return !away.some(
    (a) => a.memberId === memberId && date >= a.startDate && (a.endDate === null || date <= a.endDate)
  );
}

/** Was this member living here at all on this date? */
export function isResident(member: ResidentLike, date: string): boolean {
  return date >= member.joinedOn && (member.leftOn === null || date <= member.leftOn);
}

/**
 * Who an expense should be split between, before any manual override.
 *
 * Fixed costs (rent, wifi, maid) and bulk goods (gas cylinder, rice sack)
 * ignore the away calendar — your room doesn't disappear while you're at your
 * hometown, and a cylinder outlives any single trip. Only consumption
 * respects it.
 */
export function defaultParticipants(
  members: ResidentLike[],
  category: CategoryLike,
  date: string,
  away: AwayLike[]
): string[] {
  const residents = members.filter((m) => isResident(m, date));
  if (!category.respectsAwayCalendar) return residents.map((m) => m.id);

  const present = residents.filter((m) => isPresent(m.id, date, away));
  // Never produce an empty split: if somehow nobody was home, fall back to all
  // residents rather than dropping the expense on the floor.
  return (present.length > 0 ? present : residents).map((m) => m.id);
}

/**
 * Split a total equally, to the paisa.
 *
 * ₹100 across 3 people is ₹33.33 each, which sums to ₹99.99 — a paisa short.
 * The leftovers are handed out one at a time starting with the payer, so the
 * splits always sum to exactly the total.
 */
export function splitEqually(total: Paise, memberIds: string[], payerId?: string): Split[] {
  if (memberIds.length === 0) throw new Error('An expense needs at least one participant');
  if (!Number.isInteger(total) || total <= 0) throw new Error('Total must be positive paise');

  // Deduplicated first. A repeated id used to get one share per occurrence
  // while the base was computed from the longer list, so the splits summed to
  // MORE than the total -- money invented out of nothing. Every caller happens
  // to pass a Set today; this makes that irrelevant.
  const ids = [...new Set(memberIds)];

  const n = ids.length;
  const base = Math.floor(total / n);
  let remainder = total - base * n;

  const order =
    payerId && ids.includes(payerId) ? [payerId, ...ids.filter((id) => id !== payerId)] : ids;

  const byMember = new Map<string, Paise>(order.map((id) => [id, base]));
  for (const id of order) {
    if (remainder === 0) break;
    byMember.set(id, byMember.get(id)! + 1);
    remainder -= 1;
  }

  // Mapped over the deduplicated list, so one member appears exactly once.
  return ids.map((memberId) => ({ memberId, amountPaise: byMember.get(memberId)! }));
}

/** The one rule that must never break: splits sum to the total, exactly. */
export function assertBalanced(total: Paise, splits: Split[]): void {
  const sum = splits.reduce((acc, s) => acc + s.amountPaise, 0);
  if (sum !== total) {
    throw new Error(`Splits sum to ${sum} paise but the expense total is ${total} paise`);
  }
}
