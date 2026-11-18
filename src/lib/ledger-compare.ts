import type { Paise } from './money';

/**
 * Two months of the private ledger side by side: how the total moved, and
 * which categories moved it. Pure, so the arithmetic is tested apart from the
 * screen (tests/domain.test.ts).
 */

/** The little of an entry that a comparison needs. */
export type ComparedEntry = {
  id: string;
  amountPaise: Paise;
  category: string;
  description: string;
  spentOn: string;
};

/** One category's spending in the two months. */
export type CategoryChange = {
  slug: string;
  firstPaise: Paise;
  secondPaise: Paise;
  /** second minus first: above zero means more went on it in the second month. */
  diffPaise: Paise;
};

export type MonthComparison = {
  firstPaise: Paise;
  secondPaise: Paise;
  diffPaise: Paise;
  /** The change as a share of the first month, rounded; null when the first month is empty. */
  percent: number | null;
  /** Every category spent on in either month, biggest change first. */
  categories: CategoryChange[];
  /** Categories that went up, biggest rise first. */
  up: CategoryChange[];
  /** Categories that went down, biggest drop first. */
  down: CategoryChange[];
  /** The second month's three largest payments: what most likely drove it. */
  biggest: ComparedEntry[];
};

export function compareMonths<E extends ComparedEntry>(first: E[], second: E[]): MonthComparison {
  const sum = (xs: E[]) => xs.reduce((s, e) => s + e.amountPaise, 0);
  const byCat = new Map<string, CategoryChange>();
  const entry = (slug: string) => {
    let c = byCat.get(slug);
    if (!c) {
      c = { slug, firstPaise: 0, secondPaise: 0, diffPaise: 0 };
      byCat.set(slug, c);
    }
    return c;
  };
  for (const e of first) entry(e.category).firstPaise += e.amountPaise;
  for (const e of second) entry(e.category).secondPaise += e.amountPaise;

  const categories = [...byCat.values()]
    .map((c) => ({ ...c, diffPaise: c.secondPaise - c.firstPaise }))
    .sort(
      (a, b) =>
        Math.abs(b.diffPaise) - Math.abs(a.diffPaise) ||
        b.secondPaise - a.secondPaise ||
        a.slug.localeCompare(b.slug)
    );

  const firstPaise = sum(first);
  const secondPaise = sum(second);
  const diffPaise = secondPaise - firstPaise;
  return {
    firstPaise,
    secondPaise,
    diffPaise,
    percent: firstPaise > 0 ? Math.round((diffPaise / firstPaise) * 100) : null,
    categories,
    up: categories.filter((c) => c.diffPaise > 0),
    down: categories.filter((c) => c.diffPaise < 0),
    biggest: [...second].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 3),
  };
}

/**
 * The few categories that explain most of a move: the biggest movers in the
 * total's direction, until they account for at least 80% of it (two at most,
 * so the sentence stays short).
 */
export function mainDrivers(c: MonthComparison): CategoryChange[] {
  const movers = c.diffPaise >= 0 ? c.up : c.down;
  const target = Math.abs(c.diffPaise) * 0.8;
  const out: CategoryChange[] = [];
  let covered = 0;
  for (const m of movers) {
    if (out.length === 2) break;
    out.push(m);
    covered += Math.abs(m.diffPaise);
    if (covered >= target) break;
  }
  return out;
}
