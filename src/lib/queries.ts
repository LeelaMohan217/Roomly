import { useQuery } from '@tanstack/react-query';

import { addDays, daysInMonth, isoOf, todayIso } from '@/lib/dates';
import {
  pairwiseNets,
  type ExpenseLike,
  type PairNet,
  type SettlementLike,
} from '@/lib/pairwise';
import { supabase } from '@/lib/supabase';

/**
 * Postgres columns are snake_case; the rest of the app speaks camelCase.
 * The mapping lives here so no component ever has to know a column name.
 */

export type Member = {
  id: string;
  displayName: string;
  role: 'owner' | 'member';
  avatarColor: string;
  userId: string | null;
  joinedOn: string;
  leftOn: string | null;
};

export type Category = {
  id: string;
  name: string;
  icon: string | null;
  kind: 'fixed' | 'consumption' | 'bulk' | 'asset';
  respectsAwayCalendar: boolean;
};

export type AwayPeriod = {
  id: string;
  memberId: string;
  memberName: string;
  startDate: string;
  endDate: string | null;
  note: string | null;
};

export type Balance = {
  memberId: string;
  displayName: string;
  balancePaise: number;
};

export type Expense = {
  id: string;
  totalPaise: number;
  description: string | null;
  expenseDate: string;
  paidByName: string;
  categoryName: string;
  categoryIcon: string | null;
  participantCount: number;
};

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase
        .from('members')
        .select('id, display_name, role, avatar_color, user_id, joined_on, left_on')
        .is('left_on', null)
        .order('created_at');
      if (error) throw error;

      return data.map((m) => ({
        id: m.id,
        displayName: m.display_name,
        role: m.role,
        avatarColor: m.avatar_color,
        userId: m.user_id,
        joinedOn: m.joined_on,
        leftOn: m.left_on,
      }));
    },
  });
}

export type SpendSummary = {
  /** Everything the household spent, all members combined. */
  roomMonthPaise: number;
  roomWeekPaise: number;
  /** This member's slice of those expenses -- away calendar already applied,
   *  because it is the stored split that is being summed, not a recomputation. */
  myMonthPaise: number;
  myWeekPaise: number;
  /**
   * The same span of the previous month and week, for both scopes, so every
   * comparison is like-for-like. Comparing a month that is four days old
   * against a complete previous month would report a 90% collapse in spending
   * every month.
   */
  roomPrevMonthPaise: number;
  roomPrevWeekPaise: number;
  myPrevMonthPaise: number;
  myPrevWeekPaise: number;
};

/**
 * The four figures the home hero shows, plus the two it compares against.
 *
 * One query rather than six: a week can start in the previous month and the
 * comparison windows reach back further still, so it fetches from the earliest
 * boundary once and makes a single pass. Two months of a four-person household
 * is a couple of hundred rows.
 *
 * Windows are not capped at today -- an expense dated later this month is still
 * this month's spend, and the Reports card counts it the same way. The previous
 * month and week ARE capped, at the same point in their span, which is the
 * whole point of them.
 */
export function useSpendSummary(memberId: string | undefined) {
  return useQuery({
    // Keyed on the date so every figure re-derives when the day rolls over.
    queryKey: ['spend-summary', todayIso(), memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<SpendSummary> => {
      const today = todayIso();
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const dayOfMonth = now.getDate();

      const monthStart = isoOf(year, month, 1);
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevMonthYear = month === 1 ? year - 1 : year;
      const prevMonthStart = isoOf(prevMonthYear, prevMonth, 1);
      // Clamped: the 31st has no counterpart in a 30-day month.
      const prevMonthEnd = isoOf(
        prevMonthYear,
        prevMonth,
        Math.min(dayOfMonth, daysInMonth(prevMonthYear, prevMonth))
      );

      // Weeks start Monday: getDay() is 0 for Sunday, so shift by six.
      const elapsed = (now.getDay() + 6) % 7;
      const weekStart = addDays(today, -elapsed);
      const prevWeekStart = addDays(weekStart, -7);
      const prevWeekEnd = addDays(prevWeekStart, elapsed);

      const from = prevMonthStart < prevWeekStart ? prevMonthStart : prevWeekStart;

      const { data, error } = await supabase
        .from('expenses')
        .select('expense_date, total_paise, expense_splits ( member_id, amount_paise )')
        .is('voided_at', null)
        .gte('expense_date', from);
      if (error) throw error;

      type Row = {
        expense_date: string;
        total_paise: number;
        expense_splits: { member_id: string; amount_paise: number }[];
      };

      const totals = {
        roomMonthPaise: 0,
        roomWeekPaise: 0,
        myMonthPaise: 0,
        myWeekPaise: 0,
        roomPrevMonthPaise: 0,
        roomPrevWeekPaise: 0,
        myPrevMonthPaise: 0,
        myPrevWeekPaise: 0,
      };

      for (const e of data as unknown as Row[]) {
        const date = e.expense_date;
        const total = Number(e.total_paise);
        // A member appears at most once per expense, but sum rather than find
        // so a future change to partial splits cannot silently under-count.
        const mine = e.expense_splits
          .filter((sp) => sp.member_id === memberId)
          .reduce((a, sp) => a + Number(sp.amount_paise), 0);

        // ISO dates compare correctly as strings, so no Date objects needed.
        if (date >= monthStart) {
          totals.roomMonthPaise += total;
          totals.myMonthPaise += mine;
        }
        if (date >= weekStart) {
          totals.roomWeekPaise += total;
          totals.myWeekPaise += mine;
        }
        if (date >= prevMonthStart && date <= prevMonthEnd) {
          totals.roomPrevMonthPaise += total;
          totals.myPrevMonthPaise += mine;
        }
        if (date >= prevWeekStart && date <= prevWeekEnd) {
          totals.roomPrevWeekPaise += total;
          totals.myPrevWeekPaise += mine;
        }
      }

      return totals;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, icon, kind, respects_away_calendar, sort_order')
        .eq('is_archived', false)
        .neq('kind', 'asset')
        .order('sort_order');
      if (error) throw error;

      return data.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        kind: c.kind,
        respectsAwayCalendar: c.respects_away_calendar,
      }));
    },
    // Categories barely change; don't refetch on every screen focus.
    staleTime: 5 * 60 * 1000,
  });
}

export type ManagedCategory = Category & {
  sortOrder: number;
  isArchived: boolean;
  /** How many live expenses reference it — decides archive vs delete. */
  expenseCount: number;
};

/** Everything including archived, for the owner's management screen. */
export function useAllCategories() {
  return useQuery({
    queryKey: ['all-categories'],
    queryFn: async (): Promise<ManagedCategory[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, icon, kind, respects_away_calendar, sort_order, is_archived, expenses(count)')
        .order('sort_order');
      if (error) throw error;

      type Row = {
        id: string;
        name: string;
        icon: string | null;
        kind: 'fixed' | 'consumption' | 'bulk' | 'asset';
        respects_away_calendar: boolean;
        sort_order: number;
        is_archived: boolean;
        expenses: { count: number }[];
      };

      return (data as unknown as Row[]).map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        kind: c.kind,
        respectsAwayCalendar: c.respects_away_calendar,
        sortOrder: c.sort_order,
        isArchived: c.is_archived,
        expenseCount: c.expenses?.[0]?.count ?? 0,
      }));
    },
  });
}

export function useAwayPeriods() {
  return useQuery({
    queryKey: ['away-periods'],
    queryFn: async (): Promise<AwayPeriod[]> => {
      const { data, error } = await supabase
        .from('away_periods')
        .select('id, member_id, start_date, end_date, note, members ( display_name )')
        .order('start_date', { ascending: false });
      if (error) throw error;

      type Row = {
        id: string;
        member_id: string;
        start_date: string;
        end_date: string | null;
        note: string | null;
        members: { display_name: string } | null;
      };

      return (data as unknown as Row[]).map((a) => ({
        id: a.id,
        memberId: a.member_id,
        memberName: a.members?.display_name ?? '—',
        startDate: a.start_date,
        endDate: a.end_date,
        note: a.note,
      }));
    },
  });
}

export function useBalances() {
  return useQuery({
    queryKey: ['balances'],
    queryFn: async (): Promise<Balance[]> => {
      const { data, error } = await supabase
        .from('member_balances')
        .select('member_id, display_name, balance_paise');
      if (error) throw error;

      // balance_paise arrives as a string — Postgres bigint exceeds JS number
      // range in theory, though never at household scale.
      return data
        .map((b) => ({
          memberId: b.member_id,
          displayName: b.display_name,
          balancePaise: Number(b.balance_paise),
        }))
        .sort((a, b) => b.balancePaise - a.balancePaise);
    },
  });
}

export function useExpenses(limit = 50) {
  return useQuery({
    queryKey: ['expenses', limit],
    queryFn: async (): Promise<Expense[]> => {
      const { data, error } = await supabase
        .from('expenses')
        .select(
          `id, total_paise, description, expense_date,
           categories ( name, icon ),
           members!expenses_paid_by_fkey ( display_name ),
           expense_splits ( member_id )`
        )
        .is('voided_at', null)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      type Row = {
        id: string;
        total_paise: number;
        description: string | null;
        expense_date: string;
        categories: { name: string; icon: string | null } | null;
        members: { display_name: string } | null;
        expense_splits: { member_id: string }[];
      };

      return (data as unknown as Row[]).map((e) => ({
        id: e.id,
        totalPaise: Number(e.total_paise),
        description: e.description,
        expenseDate: e.expense_date,
        paidByName: e.members?.display_name ?? '—',
        categoryName: e.categories?.name ?? 'Uncategorised',
        categoryIcon: e.categories?.icon ?? null,
        participantCount: e.expense_splits.length,
      }));
    },
  });
}

export type ExpenseDetail = {
  id: string;
  totalPaise: number;
  description: string | null;
  expenseDate: string;
  paidBy: string;
  paidByName: string;
  createdByName: string;
  createdAt: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  periodStatus: 'open' | 'closed';
  /**
   * Whether THIS member may change this expense right now, answered by the
   * same SQL function the RLS policy uses (migration 0031). Derived here
   * rather than in TypeScript so the button and the database can never
   * disagree about whether it will work.
   */
  canEditDirectly: boolean;
  voidedAt: string | null;
  voidReason: string | null;
  splits: { memberId: string; amountPaise: number }[];
};

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expense', id],
    enabled: !!id,
    queryFn: async (): Promise<ExpenseDetail> => {
      const { data, error } = await supabase
        .from('expenses')
        .select(
          `id, total_paise, description, expense_date, paid_by, category_id,
           created_at, voided_at, void_reason, can_edit_now,
           categories ( name, icon ),
           periods ( status ),
           payer:members!expenses_paid_by_fkey ( display_name ),
           creator:members!expenses_created_by_fkey ( display_name ),
           expense_splits ( member_id, amount_paise )`
        )
        .eq('id', id!)
        .single();
      if (error) throw error;

      type Row = {
        id: string;
        total_paise: number;
        description: string | null;
        expense_date: string;
        paid_by: string;
        category_id: string;
        created_at: string;
        voided_at: string | null;
        void_reason: string | null;
        can_edit_now: boolean;
        categories: { name: string; icon: string | null } | null;
        periods: { status: 'open' | 'closed' } | null;
        payer: { display_name: string } | null;
        creator: { display_name: string } | null;
        expense_splits: { member_id: string; amount_paise: number }[];
      };

      const e = data as unknown as Row;
      return {
        id: e.id,
        totalPaise: Number(e.total_paise),
        description: e.description,
        expenseDate: e.expense_date,
        paidBy: e.paid_by,
        paidByName: e.payer?.display_name ?? '—',
        createdByName: e.creator?.display_name ?? '—',
        createdAt: e.created_at,
        categoryId: e.category_id,
        categoryName: e.categories?.name ?? 'Uncategorised',
        categoryIcon: e.categories?.icon ?? null,
        periodStatus: e.periods?.status ?? 'open',
        canEditDirectly: e.can_edit_now === true,
        voidedAt: e.voided_at,
        voidReason: e.void_reason,
        splits: e.expense_splits.map((s) => ({
          memberId: s.member_id,
          amountPaise: Number(s.amount_paise),
        })),
      };
    },
  });
}

export type PendingChange = {
  id: string;
  entityType: 'expense' | 'settlement';
  entityId: string;
  kind: 'update' | 'void';
  payload: Record<string, unknown>;
  reason: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
};

export function usePendingChanges() {
  return useQuery({
    queryKey: ['pending-changes'],
    queryFn: async (): Promise<PendingChange[]> => {
      const { data, error } = await supabase
        .from('pending_changes')
        .select(
          `id, entity_type, entity_id, kind, payload, reason, requested_by, requested_at,
           members!pending_changes_requested_by_fkey ( display_name )`
        )
        .eq('status', 'pending')
        .order('requested_at');
      if (error) throw error;

      type Row = {
        id: string;
        entity_type: 'expense' | 'settlement';
        entity_id: string;
        kind: 'update' | 'void';
        payload: Record<string, unknown>;
        reason: string | null;
        requested_by: string;
        requested_at: string;
        members: { display_name: string } | null;
      };

      return (data as unknown as Row[]).map((c) => ({
        id: c.id,
        entityType: c.entity_type,
        entityId: c.entity_id,
        kind: c.kind,
        payload: c.payload,
        reason: c.reason,
        requestedBy: c.requested_by,
        requestedByName: c.members?.display_name ?? '—',
        requestedAt: c.requested_at,
      }));
    },
  });
}

export type NotificationKind =
  | 'expense_added'
  | 'expense_changed'
  | 'expense_deleted'
  | 'settlement'
  | 'settlement_pending'
  | 'settlement_rejected'
  | 'member_added'
  | 'member_joined'
  | 'ownership_transferred';

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  actorName: string | null;
  entityId: string | null;
  amountPaise: number | null;
  subject: string | null;
  createdAt: string;
  unread: boolean;
};

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async (): Promise<AppNotification[]> => {
      const [feed, reads] = await Promise.all([
        supabase
          .from('notifications')
          .select(
            `id, kind, entity_id, amount_paise, subject, created_at,
             actor:members!notifications_actor_id_fkey ( display_name )`
          )
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('notification_reads').select('notification_id'),
      ]);

      if (feed.error) throw feed.error;
      if (reads.error) throw reads.error;

      const seen = new Set((reads.data ?? []).map((r) => r.notification_id as string));

      type Row = {
        id: string;
        kind: NotificationKind;
        entity_id: string | null;
        amount_paise: number | null;
        subject: string | null;
        created_at: string;
        actor: { display_name: string } | null;
      };

      return (feed.data as unknown as Row[]).map((n) => ({
        id: n.id,
        kind: n.kind,
        actorName: n.actor?.display_name ?? null,
        entityId: n.entity_id,
        amountPaise: n.amount_paise === null ? null : Number(n.amount_paise),
        subject: n.subject,
        createdAt: n.created_at,
        unread: !seen.has(n.id),
      }));
    },
  });
}

export type Settlement = {
  id: string;
  fromMember: string;
  fromName: string;
  toMember: string;
  toName: string;
  amountPaise: number;
  settledOn: string;
  note: string | null;
  recordedByName: string;
  voidedAt: string | null;
  /** Null until the owner confirms the money actually arrived. Balances
   *  ignore a settlement while this is null. */
  confirmedAt: string | null;
};

export function useSettlements() {
  return useQuery({
    queryKey: ['settlements'],
    queryFn: async (): Promise<Settlement[]> => {
      const { data, error } = await supabase
        .from('settlements')
        .select(
          `id, from_member, to_member, amount_paise, settled_on, note, voided_at, confirmed_at,
           payer:members!settlements_from_member_fkey ( display_name ),
           payee:members!settlements_to_member_fkey ( display_name ),
           recorder:members!settlements_created_by_fkey ( display_name )`
        )
        .order('settled_on', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      type Row = {
        id: string;
        from_member: string;
        to_member: string;
        amount_paise: number;
        settled_on: string;
        note: string | null;
        voided_at: string | null;
        confirmed_at: string | null;
        payer: { display_name: string } | null;
        payee: { display_name: string } | null;
        recorder: { display_name: string } | null;
      };

      return (data as unknown as Row[]).map((s) => ({
        id: s.id,
        fromMember: s.from_member,
        fromName: s.payer?.display_name ?? '—',
        toMember: s.to_member,
        toName: s.payee?.display_name ?? '—',
        amountPaise: Number(s.amount_paise),
        settledOn: s.settled_on,
        note: s.note,
        recordedByName: s.recorder?.display_name ?? '—',
        voidedAt: s.voided_at,
        confirmedAt: s.confirmed_at,
      }));
    },
  });
}

/**
 * Payments a member has recorded that the owner has not confirmed yet.
 *
 * Separate from useSettlements() because these are a to-do list rather than
 * history: they are excluded from every balance until confirmed, so they are
 * the one thing on the Settle screen that is waiting on a person.
 */
export function usePendingSettlements() {
  return useQuery({
    queryKey: ['pending-settlements'],
    queryFn: async (): Promise<Settlement[]> => {
      const { data, error } = await supabase
        .from('settlements')
        .select(
          `id, from_member, to_member, amount_paise, settled_on, note, voided_at, confirmed_at,
           payer:members!settlements_from_member_fkey ( display_name ),
           payee:members!settlements_to_member_fkey ( display_name ),
           recorder:members!settlements_created_by_fkey ( display_name )`
        )
        .is('confirmed_at', null)
        .is('voided_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;

      type Row = {
        id: string;
        from_member: string;
        to_member: string;
        amount_paise: number;
        settled_on: string;
        note: string | null;
        voided_at: string | null;
        confirmed_at: string | null;
        payer: { display_name: string } | null;
        payee: { display_name: string } | null;
        recorder: { display_name: string } | null;
      };

      return (data as unknown as Row[]).map((s) => ({
        id: s.id,
        fromMember: s.from_member,
        fromName: s.payer?.display_name ?? '—',
        toMember: s.to_member,
        toName: s.payee?.display_name ?? '—',
        amountPaise: Number(s.amount_paise),
        settledOn: s.settled_on,
        note: s.note,
        recordedByName: s.recorder?.display_name ?? '—',
        voidedAt: s.voided_at,
        confirmedAt: s.confirmed_at,
      }));
    },
  });
}

export type AuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorName: string | null;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/**
 * The change trail. Written only by triggers -- 0003_rls.sql revokes INSERT,
 * UPDATE and DELETE on audit_log from every client role, so nothing in the app
 * can forge or erase an entry. Everyone in the household can read all of it,
 * which is the point: the ledger is only trustworthy if edits are visible.
 */
export function useAuditLog(limit = 200) {
  return useQuery({
    queryKey: ['audit-log', limit],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from('audit_log')
        .select(
          `id, entity_type, entity_id, action, created_at, before, after,
           actor:members!audit_log_actor_id_fkey ( display_name )`
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      type Row = {
        id: number;
        entity_type: string;
        entity_id: string;
        action: string;
        created_at: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        actor: { display_name: string } | null;
      };

      return (data as unknown as Row[]).map((r) => ({
        id: String(r.id),
        entityType: r.entity_type,
        entityId: r.entity_id,
        action: r.action,
        actorName: r.actor?.display_name ?? null,
        at: r.created_at,
        before: r.before,
        after: r.after,
      }));
    },
  });
}

export type MonthStatement = {
  year: number;
  month: number;
  status: 'open' | 'closed' | 'none';
  totalPaise: number;
  expenseCount: number;
  byCategory: { name: string; icon: string | null; totalPaise: number }[];
  perMember: {
    memberId: string;
    name: string;
    paidPaise: number;
    owedPaise: number;
    netPaise: number;
    /** They have since moved out, but took part in this month. */
    hasLeft: boolean;
  }[];
  settlements: { id: string; fromName: string; toName: string; amountPaise: number }[];
};

/** Everything that happened in one month, for the close-out statement. */
export function useMonthStatement(year: number, month: number) {
  return useQuery({
    queryKey: ['month-statement', year, month],
    queryFn: async (): Promise<MonthStatement> => {
      const first = `${year}-${String(month).padStart(2, '0')}-01`;
      // Day 0 of next month = last day of this one, without a calendar table.
      const lastDay = new Date(year, month, 0).getDate();
      const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const [period, expenses, settlements, members] = await Promise.all([
        supabase.from('periods').select('status').eq('year', year).eq('month', month).maybeSingle(),
        supabase
          .from('expenses')
          .select(
            `id, total_paise, paid_by, categories ( name, icon ), expense_splits ( member_id, amount_paise )`
          )
          .gte('expense_date', first)
          .lte('expense_date', last)
          .is('voided_at', null),
        supabase
          .from('settlements')
          .select(
            `id, amount_paise,
             payer:members!settlements_from_member_fkey ( display_name ),
             payee:members!settlements_to_member_fkey ( display_name )`
          )
          .gte('settled_on', first)
          .lte('settled_on', last)
          .is('voided_at', null)
          // Confirmed only, exactly as member_balances and member_ledger do.
          // Without this the statement listed a payment nobody had confirmed
          // receiving under "PAYMENTS THIS MONTH", as though it had happened,
          // while every balance in the app excluded it. That is the same
          // divergence migration 0020 was written to fix between two views —
          // this was its third occurrence, in the client.
          .not('confirmed_at', 'is', null),
        // Everyone, including people who have since moved out. Filtering on
        // `left_on is null` here while fetching expenses unfiltered meant a
        // flatmate who left in October still counted toward September's
        // totalPaise and byCategory but had no row in perMember — so the
        // per-member table did not add up to the figure in the hero, on the
        // one screen whose whole job is reconciliation.
        supabase.from('members').select('id, display_name, left_on'),
      ]);

      if (expenses.error) throw expenses.error;
      if (settlements.error) throw settlements.error;
      if (members.error) throw members.error;

      type ExpRow = {
        total_paise: number;
        paid_by: string;
        categories: { name: string; icon: string | null } | null;
        expense_splits: { member_id: string; amount_paise: number }[];
      };

      const rows = expenses.data as unknown as ExpRow[];
      const paid = new Map<string, number>();
      const owed = new Map<string, number>();
      const cats = new Map<string, { name: string; icon: string | null; totalPaise: number }>();
      let total = 0;

      for (const e of rows) {
        const amount = Number(e.total_paise);
        total += amount;
        paid.set(e.paid_by, (paid.get(e.paid_by) ?? 0) + amount);

        const key = e.categories?.name ?? 'Uncategorised';
        const cat = cats.get(key) ?? {
          name: key,
          icon: e.categories?.icon ?? null,
          totalPaise: 0,
        };
        cat.totalPaise += amount;
        cats.set(key, cat);

        for (const s of e.expense_splits) {
          owed.set(s.member_id, (owed.get(s.member_id) ?? 0) + Number(s.amount_paise));
        }
      }

      return {
        year,
        month,
        status: (period.data?.status as 'open' | 'closed') ?? 'none',
        totalPaise: total,
        expenseCount: rows.length,
        byCategory: [...cats.values()].sort((a, b) => b.totalPaise - a.totalPaise),
        perMember: (members.data ?? [])
          .map((m) => {
            const p = paid.get(m.id) ?? 0;
            const o = owed.get(m.id) ?? 0;
            return {
              memberId: m.id,
              name: m.display_name,
              paidPaise: p,
              owedPaise: o,
              netPaise: p - o,
              hasLeft: m.left_on !== null,
            };
          })
          // Departed members are kept only where they actually took part in
          // this month, so a long-closed month still reconciles while a
          // current one is not cluttered by people who have moved out.
          .filter((r) => !r.hasLeft || r.paidPaise !== 0 || r.owedPaise !== 0)
          .sort((a, b) => b.netPaise - a.netPaise),
        settlements: (settlements.data as unknown as {
          id: string;
          amount_paise: number;
          payer: { display_name: string } | null;
          payee: { display_name: string } | null;
        }[]).map((s) => ({
          id: s.id,
          fromName: s.payer?.display_name ?? '—',
          toName: s.payee?.display_name ?? '—',
          amountPaise: Number(s.amount_paise),
        })),
      };
    },
  });
}

export type Recurring = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  description: string | null;
  amountPaise: number | null;
  paidBy: string;
  paidByName: string;
  dayOfMonth: number;
  mode: 'auto' | 'confirm';
  isActive: boolean;
  /** Has this rule already produced an expense this month? */
  postedThisMonth: boolean;
  /** Active, past its day, and not yet posted. */
  isDue: boolean;
  /**
   * Months this rule was due in and never posted, oldest first, as
   * { year, month, dueDate }. Empty for anything up to date.
   *
   * Without this a 'confirm' bill nobody typed an amount for simply vanished
   * at the month rollover: isDue only ever looked at the current month, so
   * September's electricity stopped being asked for on 1 October and left no
   * trace anywhere -- no nag, no gap in Reports, nothing.
   */
  overdue: { year: number; month: number; dueDate: string }[];
};

/** How far back to chase an unposted bill. Matches the backfill window in
 *  migration 0023, so the two halves agree on what "missed" means. */
const OVERDUE_MONTHS = 11;

export function useRecurring() {
  return useQuery({
    queryKey: ['recurring'],
    queryFn: async (): Promise<Recurring[]> => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const dayToday = now.getDate();

      // Every month we might still owe a posting for, oldest first.
      const window: { year: number; month: number }[] = [];
      for (let back = OVERDUE_MONTHS; back >= 0; back -= 1) {
        const d = new Date(year, month - 1 - back, 1);
        window.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
      }
      const earliest = window[0];

      const [rules, postings] = await Promise.all([
        supabase
          .from('recurring_expenses')
          .select(
            `id, category_id, description, amount_paise, paid_by, day_of_month, mode, is_active,
             created_at,
             categories ( name, icon ),
             members!recurring_expenses_paid_by_fkey ( display_name )`
          )
          .order('day_of_month'),
        // The whole window, not just this month.
        supabase
          .from('recurring_postings')
          .select('recurring_id, year, month')
          .gte('year', earliest.year),
      ]);

      if (rules.error) throw rules.error;
      if (postings.error) throw postings.error;

      const postedKeys = new Set(
        (postings.data ?? []).map((p) => `${p.recurring_id}|${p.year}|${p.month}`)
      );
      const posted = new Set(
        (postings.data ?? [])
          .filter((p) => p.year === year && p.month === month)
          .map((p) => p.recurring_id as string)
      );

      type Row = {
        id: string;
        category_id: string;
        description: string | null;
        amount_paise: number | null;
        paid_by: string;
        day_of_month: number;
        mode: 'auto' | 'confirm';
        is_active: boolean;
        created_at: string;
        categories: { name: string; icon: string | null } | null;
        members: { display_name: string } | null;
      };

      const todayStr = todayIso();

      return (rules.data as unknown as Row[]).map((r) => {
        const postedThisMonth = posted.has(r.id);
        const createdOn = r.created_at.slice(0, 10);

        // Months this rule was due in and never posted. Excludes the current
        // month, which `isDue` already covers, and anything before the rule
        // existed.
        const overdue = window
          .filter((w) => !(w.year === year && w.month === month))
          .map((w) => {
            // Clamped, same as the SQL: a rule set to the 31st falls due on
            // the 28th in February rather than never.
            const lastDay = daysInMonth(w.year, w.month);
            return { ...w, dueDate: isoOf(w.year, w.month, Math.min(r.day_of_month, lastDay)) };
          })
          .filter(
            (w) =>
              w.dueDate <= todayStr &&
              w.dueDate >= createdOn &&
              !postedKeys.has(`${r.id}|${w.year}|${w.month}`)
          );

        return {
          id: r.id,
          categoryId: r.category_id,
          categoryName: r.categories?.name ?? 'Uncategorised',
          categoryIcon: r.categories?.icon ?? null,
          description: r.description,
          amountPaise: r.amount_paise === null ? null : Number(r.amount_paise),
          paidBy: r.paid_by,
          paidByName: r.members?.display_name ?? '—',
          dayOfMonth: r.day_of_month,
          mode: r.mode,
          isActive: r.is_active,
          postedThisMonth,
          isDue: r.is_active && !postedThisMonth && dayToday >= r.day_of_month,
          overdue: r.is_active ? overdue : [],
        };
      });
    },
  });
}


/**
 * Everything needed to say "why does Vinod owe me anything" — by expense.
 *
 * Unbounded in time on purpose. Balances are all-time, and pairwiseNets() is
 * asserted to sum to the balance, so anything less than the full history would
 * break that reconciliation rather than merely be incomplete. A household's
 * whole ledger is a few hundred rows — the same justification useMonthlyTotals
 * already makes.
 *
 * Confirmed settlements only, matching member_balances (migration 0019). An
 * unconfirmed payment is in nobody's balance, so counting it here would make
 * the pairwise view disagree with every other number in the app.
 */
export function usePairwiseLedger(memberId: string | undefined) {
  return useQuery({
    queryKey: ['pairwise', memberId],
    enabled: !!memberId,
    queryFn: async (): Promise<PairNet[]> => {
      const [expenses, settlements] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            `id, expense_date, total_paise, description, paid_by,
             categories ( name ),
             expense_splits ( member_id, amount_paise )`
          )
          .is('voided_at', null)
          .order('expense_date', { ascending: false }),
        supabase
          .from('settlements')
          .select('id, settled_on, from_member, to_member, amount_paise')
          .is('voided_at', null)
          .not('confirmed_at', 'is', null),
      ]);

      if (expenses.error) throw expenses.error;
      if (settlements.error) throw settlements.error;

      type ExpRow = {
        id: string;
        expense_date: string;
        total_paise: number;
        description: string | null;
        paid_by: string;
        categories: { name: string } | null;
        expense_splits: { member_id: string; amount_paise: number }[];
      };

      const mapped: ExpenseLike[] = (expenses.data as unknown as ExpRow[]).map((e) => ({
        id: e.id,
        date: e.expense_date,
        categoryName: e.categories?.name ?? 'Uncategorised',
        description: e.description,
        paidBy: e.paid_by,
        totalPaise: Number(e.total_paise),
        splits: e.expense_splits.map((s) => ({
          memberId: s.member_id,
          amountPaise: Number(s.amount_paise),
        })),
      }));

      const paid: SettlementLike[] = (settlements.data ?? []).map((t) => ({
        id: t.id as string,
        date: t.settled_on as string,
        fromMember: t.from_member as string,
        toMember: t.to_member as string,
        amountPaise: Number(t.amount_paise),
      }));

      return pairwiseNets(memberId!, mapped, paid);
    },
  });
}

export type CategoryTotal = {
  year: number;
  month: number;
  categoryId: string;
  categoryName: string;
  icon: string | null;
  kind: 'fixed' | 'consumption' | 'bulk' | 'asset';
  totalPaise: number;
  expenseCount: number;
};

/** Backs the Reports screen. Grouping happens on the client — a household's
 *  whole history is a few hundred rows at most. */
export function useMonthlyTotals() {
  return useQuery({
    queryKey: ['monthly-totals'],
    queryFn: async (): Promise<CategoryTotal[]> => {
      const { data, error } = await supabase
        .from('monthly_category_totals')
        .select('year, month, category_id, category_name, kind, total_paise, expense_count')
        .order('year', { ascending: false })
        .order('month', { ascending: false });
      if (error) throw error;

      // The view doesn't expose the icon slug, so pull it from categories.
      // The error was previously discarded, so a failure here rendered every
      // Reports row without its icon and said nothing.
      const { data: cats, error: catsError } = await supabase
        .from('categories')
        .select('id, icon');
      if (catsError) throw catsError;
      const iconById = new Map((cats ?? []).map((c) => [c.id, c.icon as string | null]));

      return data.map((t) => ({
        year: t.year,
        month: t.month,
        categoryId: t.category_id,
        categoryName: t.category_name,
        icon: iconById.get(t.category_id) ?? null,
        kind: t.kind,
        totalPaise: Number(t.total_paise),
        expenseCount: Number(t.expense_count),
      }));
    },
  });
}

export type Period = {
  id: string;
  year: number;
  month: number;
  status: 'open' | 'closed';
};

export function usePeriods() {
  return useQuery({
    queryKey: ['periods'],
    queryFn: async (): Promise<Period[]> => {
      const { data, error } = await supabase
        .from('periods')
        .select('id, year, month, status')
        .order('year', { ascending: false })
        .order('month', { ascending: false });
      if (error) throw error;
      return data as Period[];
    },
  });
}

/**
 * The one-tap chips on Add Expense. A household buys the same ten things over
 * and over, so the fastest possible entry is "the thing I bought last time".
 * Derived from history rather than a list you have to curate.
 */
export function useSuggestions() {
  return useQuery({
    queryKey: ['suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('description, total_paise, category_id')
        .is('voided_at', null)
        .not('description', 'is', null)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;

      const seen = new Map<
        string,
        { label: string; amountPaise: number; categoryId: string; count: number }
      >();

      for (const row of data as {
        description: string;
        total_paise: number;
        category_id: string;
      }[]) {
        const key = `${row.description.toLowerCase()}|${row.total_paise}`;
        const hit = seen.get(key);
        if (hit) {
          hit.count += 1;
        } else {
          seen.set(key, {
            label: row.description,
            amountPaise: Number(row.total_paise),
            categoryId: row.category_id,
            count: 1,
          });
        }
      }

      return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 4);
    },
  });
}
