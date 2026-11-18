/**
 * Home's one-line insights under the month card: every short, true thing the
 * household's month says. Home shows one at a time, rotating each time it
 * opens, and you can hide one you've already read (lib/insight-hidden).
 * Pure, so it is tested apart from the screen (tests/domain.test.ts).
 *
 * Only claims that are true on the day they are read. Mid-month, "less than
 * October" would only mean the month is not over, so a fall is said only in
 * the last week. A category that has already passed all of last month is true
 * whatever the day.
 *
 * Fixed costs (rent, wifi) are left out: they move only when the bill does.
 */

type Row = {
  year: number;
  month: number;
  categoryName: string;
  kind: 'fixed' | 'consumption' | 'bulk' | 'asset';
  totalPaise: number;
};

export type Insight = {
  /**
   * Stable for this insight in this month ("2026-11:up:Groceries"), whatever
   * its amounts: hidden stays hidden as the figures move, and a new month
   * starts with nothing hidden.
   */
  key: string;
  tone: 'up' | 'down' | 'plain';
  /** The lead, in bold: "₹509 more on Groceries". */
  lead: string;
  /** The rest of the sentence. */
  rest: string;
};

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** A fall is only worth saying if it is at least this much... */
const MIN_DROP_PERCENT = 10;
/** ...and at least ₹200: 50% of ₹40 is nothing. */
const MIN_DROP_PAISE = 20000;
/** "The last week": from this day of the month on. */
const LAST_WEEK_FROM = 24;
/** At most this many of each kind, so the rotation stays to what matters. */
const MAX_EACH = 3;

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

/** Every insight that holds today, most useful first. */
export function homeInsights(
  rows: Row[],
  year: number,
  month: number,
  dayOfMonth: number
): Insight[] {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevName = MONTHS_LONG[prevMonth - 1];
  const stamp = `${year}-${String(month).padStart(2, '0')}`;

  const byName = (y: number, m: number) => {
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.year !== y || r.month !== m || r.kind === 'fixed' || r.totalPaise <= 0) continue;
      out.set(r.categoryName, (out.get(r.categoryName) ?? 0) + r.totalPaise);
    }
    return out;
  };
  const now = byName(year, month);
  const before = byName(prevYear, prevMonth);
  const out: Insight[] = [];

  // 1. Already more than all of last month: true whatever the day. Biggest
  //    jump first.
  const overs = [...now]
    .map(([name, total]) => ({ name, total, last: before.get(name) ?? 0 }))
    .filter((c) => c.last > 0 && c.total > c.last)
    .sort((a, b) => b.total - b.last - (a.total - a.last))
    .slice(0, MAX_EACH);
  for (const c of overs) {
    out.push({
      key: `${stamp}:up:${c.name}`,
      tone: 'up',
      lead: `${rupees(c.total - c.last)} more on ${c.name}`,
      rest: ` than last month. ${rupees(c.total)} this month, ${rupees(c.last)} in ${prevName}.`,
    });
  }

  // 2. In the month's last week, real falls. Biggest saving first.
  if (dayOfMonth >= LAST_WEEK_FROM) {
    const drops = [...before]
      .map(([name, last]) => ({ name, last, total: now.get(name) ?? 0 }))
      .filter(
        (c) =>
          Math.round(((c.last - c.total) / c.last) * 100) >= MIN_DROP_PERCENT &&
          c.last - c.total >= MIN_DROP_PAISE
      )
      .sort((a, b) => b.last - b.total - (a.last - a.total))
      .slice(0, MAX_EACH);
    for (const c of drops) {
      out.push({
        key: `${stamp}:down:${c.name}`,
        tone: 'down',
        lead: `${rupees(c.last - c.total)} less on ${c.name}`,
        rest: ` than last month. ${rupees(c.total)} this month, ${rupees(c.last)} in ${prevName}.`,
      });
    }
  }

  // 3. Where the day-to-day money is going: always true, so always offered.
  let top: { name: string; total: number } | null = null;
  for (const [name, total] of now) if (!top || total > top.total) top = { name, total };
  if (top) {
    out.push({
      key: `${stamp}:top:${top.name}`,
      tone: 'plain',
      lead: `${top.name} is your biggest spend`,
      rest: ` this month so far: ${rupees(top.total)}.`,
    });
  }
  return out;
}

/** The single most useful insight, or null: the first of homeInsights. */
export function homeInsight(
  rows: Row[],
  year: number,
  month: number,
  dayOfMonth: number
): Insight | null {
  return homeInsights(rows, year, month, dayOfMonth)[0] ?? null;
}

/**
 * Which insight Home shows: the next one not hidden, turning one step each
 * time Home opens (`turn` counts the opens). Null when all are hidden.
 */
export function pickInsight(all: Insight[], hidden: ReadonlySet<string>, turn: number): Insight | null {
  const shown = all.filter((i) => !hidden.has(i.key));
  if (shown.length === 0) return null;
  return shown[((turn % shown.length) + shown.length) % shown.length];
}
