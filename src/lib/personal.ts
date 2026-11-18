import type { IconName } from '@/components/ui/icon';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { daysInMonth, isoOf } from '@/lib/dates';
import type { Paise } from '@/lib/money';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * The private ledger: spending that is yours alone (migration 0043).
 *
 * Its own table, readable only by the account that wrote it -- never the
 * household's `expenses` with a flag on. Nothing here touches balances,
 * approvals, notifications, Reports or statements, and nothing there can
 * reach this.
 *
 * Rows belong to the account, not to a household member, so the queries are
 * keyed by user id: a second account on this phone never sees the first one's
 * cached ledger.
 */

/** Categories for private spending. Slugs are stored; labels and icons live here. */
// Each colour is a mid tone, readable as an icon on both the light and the dark
// page; its tile is the same colour at low opacity (see tintOf). Each icon is
// a name from the app's Lucide icon map (components/ui/icon).
export const PERSONAL_CATEGORIES = [
  { slug: 'food', label: 'Food', icon: 'silverware-fork-knife', color: '#E8762C' },
  { slug: 'groceries', label: 'Groceries', icon: 'cart-outline', color: '#2F9E5B' },
  { slug: 'travel', label: 'Travel', icon: 'bus', color: '#2F7FD8' },
  { slug: 'fuel', label: 'Fuel', icon: 'gas-station-outline', color: '#C2410C' },
  { slug: 'shopping', label: 'Shopping', icon: 'shopping-outline', color: '#D9468F' },
  { slug: 'bills', label: 'Bills', icon: 'receipt', color: '#6B6FD6' },
  { slug: 'health', label: 'Health', icon: 'heart-pulse', color: '#E0484F' },
  { slug: 'fitness', label: 'Fitness', icon: 'dumbbell', color: '#0E9A8A' },
  { slug: 'fun', label: 'Fun', icon: 'party-popper', color: '#9B59D0' },
  { slug: 'gifts', label: 'Gifts', icon: 'gift-outline', color: '#C9922A' },
  { slug: 'education', label: 'Education', icon: 'school-outline', color: '#3B82B8' },
  { slug: 'misc', label: 'Other', icon: 'package-variant-closed', color: '#7C8592' },
] as const satisfies readonly { slug: string; label: string; icon: IconName; color: string }[];

/** A category colour as a soft tile behind its icon. */
export function tintOf(color: string): string {
  return `${color}24`;
}

export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number]['slug'];

export function personalCategory(slug: string) {
  return (
    PERSONAL_CATEGORIES.find((c) => c.slug === slug) ??
    PERSONAL_CATEGORIES[PERSONAL_CATEGORIES.length - 1]
  );
}

export type PersonalExpense = {
  id: string;
  amountPaise: Paise;
  description: string;
  category: string;
  spentOn: string;
  note: string | null;
  createdAt: string;
};

/** A month (1-12) of a year, or a whole year (month null). */
export type LedgerPeriod = { year: number; month: number | null };

export type PersonalSummary = {
  /** The period's rows, newest first. */
  expenses: PersonalExpense[];
  totalPaise: Paise;
  /** The month or year before, for "more / less than". */
  prevTotalPaise: Paise;
  byCategory: { slug: string; totalPaise: Paise }[];
  /** Year view only: each month's total, January first. Empty for a month. */
  byMonth: Paise[];
};

type Row = {
  id: string;
  amount_paise: number | string;
  description: string;
  category: string;
  spent_on: string;
  note: string | null;
  created_at: string;
};

function fromRow(r: Row): PersonalExpense {
  return {
    id: r.id,
    amountPaise: Number(r.amount_paise),
    description: r.description,
    category: r.category,
    spentOn: r.spent_on,
    note: r.note,
    createdAt: r.created_at,
  };
}

/**
 * The database has not had 0043 run yet. Said apart from other failures, so
 * the screen can say so plainly instead of "That did not work".
 */
export function isLedgerMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === 'PGRST205';
}

/** First and last day of a period, and the start of the one before it. */
function boundsOf({ year, month }: LedgerPeriod) {
  if (month === null) {
    return { prevStart: isoOf(year - 1, 1, 1), start: isoOf(year, 1, 1), end: isoOf(year, 12, 31) };
  }
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return {
    prevStart: isoOf(prev.year, prev.month, 1),
    start: isoOf(year, month, 1),
    end: isoOf(year, month, daysInMonth(year, month)),
  };
}

/** One month or one year of the ledger, with the period before's total. */
export function usePersonalPeriod(period: LedgerPeriod) {
  const { session } = useSession();
  const userId = session?.user.id;
  const { year, month } = period;

  return useQuery({
    queryKey: ['personal-month', userId, year, month],
    enabled: !!userId,
    queryFn: async (): Promise<PersonalSummary> => {
      const { prevStart: from, start: thisStart, end: to } = boundsOf(period);

      const { data, error } = await supabase
        .from('personal_expenses')
        .select('id, amount_paise, description, category, spent_on, note, created_at')
        .gte('spent_on', from)
        .lte('spent_on', to)
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = (data as Row[]).map(fromRow);
      const expenses = rows.filter((e) => e.spentOn >= thisStart);
      const totalPaise = expenses.reduce((sum, e) => sum + e.amountPaise, 0);
      const prevTotalPaise = rows
        .filter((e) => e.spentOn < thisStart)
        .reduce((sum, e) => sum + e.amountPaise, 0);

      const totals = new Map<string, number>();
      for (const e of expenses)
        totals.set(e.category, (totals.get(e.category) ?? 0) + e.amountPaise);
      const byCategory = [...totals.entries()]
        .map(([slug, total]) => ({ slug, totalPaise: total }))
        .sort((a, b) => b.totalPaise - a.totalPaise);

      const byMonth: Paise[] = [];
      if (month === null) {
        for (let m = 0; m < 12; m++) byMonth.push(0);
        for (const e of expenses) byMonth[Number(e.spentOn.slice(5, 7)) - 1] += e.amountPaise;
      }

      return { expenses, totalPaise, prevTotalPaise, byCategory, byMonth };
    },
  });
}

/**
 * Several whole months at once, newest first: My ledger's History when more
 * than one month is picked. Off while none are.
 */
export function usePersonalMonths(months: { year: number; month: number }[]) {
  const { session } = useSession();
  const userId = session?.user.id;
  const keys = months
    .map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`)
    .sort()
    .reverse();

  return useQuery({
    queryKey: ['personal-month', userId, 'months', keys.join(',')],
    enabled: !!userId && keys.length > 0,
    queryFn: async (): Promise<{ expenses: PersonalExpense[]; totalPaise: Paise }> => {
      // One date range per month, any of them: or=(and(gte,lte),and(gte,lte)).
      const ranges = keys.map((k) => {
        const [y, m] = k.split('-').map(Number);
        return `and(spent_on.gte.${isoOf(y, m, 1)},spent_on.lte.${isoOf(y, m, daysInMonth(y, m))})`;
      });
      const out: PersonalExpense[] = [];
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from('personal_expenses')
          .select('id, amount_paise, description, category, spent_on, note, created_at')
          .or(ranges.join(','))
          .order('spent_on', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        out.push(...(data as Row[]).map(fromRow));
        if (data.length < PAGE) break;
      }
      return { expenses: out, totalPaise: out.reduce((s, e) => s + e.amountPaise, 0) };
    },
  });
}

/** How many of the newest entries "All months" lists. */
const ALL_LIMIT = 500;

/** Every month at once, newest first: My ledger's History before a month is picked. */
export function usePersonalAll() {
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['personal-month', userId, 'all'],
    enabled: !!userId,
    queryFn: async (): Promise<PersonalExpense[]> => {
      const { data, error } = await supabase
        .from('personal_expenses')
        .select('id, amount_paise, description, category, spent_on, note, created_at')
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(ALL_LIMIT);
      if (error) throw error;
      return (data as Row[]).map(fromRow);
    },
  });
}

/** Each month that has entries, newest first, with its total: the statement page's month list. */
export function usePersonalMonthTotals() {
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['personal-month', userId, 'totals'],
    enabled: !!userId,
    queryFn: async (): Promise<{ year: number; month: number; totalPaise: Paise }[]> => {
      const totals = new Map<string, number>();
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from('personal_expenses')
          .select('spent_on, amount_paise')
          .order('spent_on', { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        for (const r of data as { spent_on: string; amount_paise: number | string }[]) {
          const k = r.spent_on.slice(0, 7);
          totals.set(k, (totals.get(k) ?? 0) + Number(r.amount_paise));
        }
        if (data.length < PAGE) break;
      }
      return [...totals.entries()]
        .map(([k, totalPaise]) => ({
          year: Number(k.slice(0, 4)),
          month: Number(k.slice(5, 7)),
          totalPaise,
        }))
        .sort((a, b) => b.year - a.year || b.month - a.month);
    },
  });
}

/** The most rows one search returns: plenty to find a payment by. */
const SEARCH_LIMIT = 200;

/**
 * Every month at once: entries whose "what for", note or category name holds
 * the text, newest first. Off while the text is empty.
 */
export function usePersonalSearch(text: string) {
  const { session } = useSession();
  const userId = session?.user.id;
  // PostgREST's or= filter splits on commas and brackets, and ilike treats %
  // and _ as wildcards; none of them help anyone find a payment.
  const needle = text
    .trim()
    .toLowerCase()
    .replace(/[,()%_*\\"]/g, ' ')
    .trim();

  return useQuery({
    queryKey: ['personal-month', userId, 'search', needle],
    enabled: !!userId && needle.length > 0,
    queryFn: async (): Promise<{ expenses: PersonalExpense[]; totalPaise: Paise }> => {
      const slugs = PERSONAL_CATEGORIES.filter((c) => c.label.toLowerCase().includes(needle)).map(
        (c) => c.slug
      );
      const filters = [`description.ilike.*${needle}*`, `note.ilike.*${needle}*`];
      if (slugs.length) filters.push(`category.in.(${slugs.join(',')})`);

      const { data, error } = await supabase
        .from('personal_expenses')
        .select('id, amount_paise, description, category, spent_on, note, created_at')
        .or(filters.join(','))
        .order('spent_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(SEARCH_LIMIT);
      if (error) throw error;

      const expenses = (data as Row[]).map(fromRow);
      return { expenses, totalPaise: expenses.reduce((sum, e) => sum + e.amountPaise, 0) };
    },
  });
}

/** One expense, for its edit page. */
export function usePersonalExpense(id: string | undefined) {
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ['personal-month', userId, 'one', id],
    enabled: !!userId && !!id,
    queryFn: async (): Promise<PersonalExpense | null> => {
      const { data, error } = await supabase
        .from('personal_expenses')
        .select('id, amount_paise, description, category, spent_on, note, created_at')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data ? fromRow(data as Row) : null;
    },
  });
}

export type PersonalDraft = {
  amountPaise: Paise;
  description: string;
  category: string;
  spentOn: string;
  note: string | null;
};

/** Add, change and delete. Each re-reads every cached month afterwards. */
export function usePersonalMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['personal-month'] });

  const add = useMutation({
    // The key is minted by the form when it opens, not here: a retried
    // mutation runs this function again, and a fresh key each time would
    // make every retry a second row.
    mutationFn: async ({ draft, clientId }: { draft: PersonalDraft; clientId: string }) => {
      const { error } = await supabase.from('personal_expenses').upsert(
        {
          amount_paise: draft.amountPaise,
          description: draft.description.trim(),
          category: draft.category,
          spent_on: draft.spentOn,
          note: draft.note?.trim() || null,
          client_id: clientId,
        },
        { onConflict: 'user_id,client_id', ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: PersonalDraft }) => {
      const { error } = await supabase
        .from('personal_expenses')
        .update({
          amount_paise: draft.amountPaise,
          description: draft.description.trim(),
          category: draft.category,
          spent_on: draft.spentOn,
          note: draft.note?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('personal_expenses').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { add, update, remove };
}
