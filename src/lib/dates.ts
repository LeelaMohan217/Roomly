/**
 * Calendar dates are plain 'YYYY-MM-DD' strings throughout the app, never
 * Date objects. Dates compare and sort correctly as strings, they survive a
 * round trip through JSON, and they can't drift across midnight the way a
 * UTC timestamp does — 11pm IST is already tomorrow in UTC, which would put
 * an expense in the wrong day and, at month end, the wrong period.
 */

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Today in the device's own timezone, not UTC. */
export function todayIso(): string {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Inclusive day count: the 5th to the 7th is 3 days. */
export function daysBetween(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T00:00:00`).getTime();
  const b = new Date(`${endIso}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Weekday of the 1st, 0 = Sunday. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export function formatRange(startIso: string, endIso: string | null): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
    });

  if (!endIso) return `${fmt(startIso, true)} — open ended`;
  if (startIso === endIso) return fmt(startIso, true);
  return `${fmt(startIso, false)} – ${fmt(endIso, true)}`;
}

/** Does a date fall inside an away period, treating a null end as open? */
export function withinRange(iso: string, startIso: string, endIso: string | null): boolean {
  return iso >= startIso && (endIso === null || iso <= endIso);
}
