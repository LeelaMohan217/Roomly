import type { Paise } from './money';

/**
 * Who owes whom, before any simplification.
 *
 * simplifyDebts() answers "what is the fastest way to clear this household",
 * and that answer routes your money to whoever it settles quickest -- often
 * somebody you have never shared an expense with. Shown on its own it reads as
 * arbitrary, and the Settle screen's only explanation was an aggregate total
 * that did not even match the transfer it sat under.
 *
 * This module answers the question people actually ask: "why does Vinod owe me
 * anything?" -- by name, by expense, by amount.
 *
 * Deliberately structural types rather than the Supabase row types, matching
 * split.ts and settle.ts, so the whole thing is testable without a database.
 */

export type ExpenseLike = {
  id: string;
  date: string;
  categoryName: string;
  description: string | null;
  paidBy: string;
  totalPaise: Paise;
  splits: { memberId: string; amountPaise: Paise }[];
  /**
   * When it entered the ledger (created_at). Only lastSquaredAt() reads it --
   * `date` is the day the money was spent, which can be backdated, so it says
   * nothing about whether this came before or after a settle-up.
   */
  at?: string;
};

export type SettlementLike = {
  id: string;
  date: string;
  fromMember: string;
  toMember: string;
  amountPaise: Paise;
  /** When it started counting (confirmed_at). See ExpenseLike.at. */
  at?: string;
};

/** One row of the "why" list: a single expense, seen from my side. */
export type PairLine = {
  kind: 'expense' | 'settlement';
  id: string;
  date: string;
  categoryName: string;
  description: string | null;
  /** True when I paid and they owe me a share of it. */
  iPaid: boolean;
  totalPaise: Paise;
  /** Their share of it, or the settlement amount. */
  theirSharePaise: Paise;
  /** Mine. Zero for a settlement. */
  mySharePaise: Paise;
  /** What this row moved the net by. Positive means they owe me more. */
  deltaPaise: Paise;
  /**
   * Settlements only: the part of the payment that cleared a debt between
   * these two people. Undefined on an expense.
   */
  directPaise?: Paise;
  /**
   * Settlements only: the part that was only passing through -- see
   * annotateRouting() below. Always directPaise + routedPaise === totalPaise.
   */
  routedPaise?: Paise;
};

export type PairNet = {
  memberId: string;
  /** Positive: they owe me. Negative: I owe them. */
  netPaise: Paise;
  lines: PairLine[];
};

/**
 * My position against every other member, from shared expenses and confirmed
 * settlements.
 *
 * The rule for one expense: whoever PAID is owed each other participant's
 * share. So if I paid, every other participant's share is a credit to me; if
 * they paid, my share is a debit. My own share of my own expense nets to
 * nothing and is never counted -- that is the double-count this is easy to get
 * wrong on.
 *
 * A settlement moves the net by its full amount in the obvious direction. Pass
 * ONLY confirmed, unvoided settlements: an unconfirmed one is excluded from
 * member_balances (migration 0019) and including it here would break the
 * reconciliation below.
 */
export function pairwiseNets(
  myId: string,
  expenses: ExpenseLike[],
  settlements: SettlementLike[]
): PairNet[] {
  const byMember = new Map<string, PairNet>();

  const bucket = (memberId: string): PairNet => {
    let hit = byMember.get(memberId);
    if (!hit) {
      hit = { memberId, netPaise: 0, lines: [] };
      byMember.set(memberId, hit);
    }
    return hit;
  };

  for (const e of expenses) {
    const myShare = e.splits.find((s) => s.memberId === myId)?.amountPaise ?? 0;

    if (e.paidBy === myId) {
      // I paid. Everyone else in the split owes me their share.
      for (const s of e.splits) {
        if (s.memberId === myId || s.amountPaise === 0) continue;
        const pair = bucket(s.memberId);
        pair.netPaise += s.amountPaise;
        pair.lines.push({
          kind: 'expense',
          id: e.id,
          date: e.date,
          categoryName: e.categoryName,
          description: e.description,
          iPaid: true,
          totalPaise: e.totalPaise,
          theirSharePaise: s.amountPaise,
          mySharePaise: myShare,
          deltaPaise: s.amountPaise,
        });
      }
    } else if (myShare > 0) {
      // They paid and I was in it. I owe them my share -- and only my share,
      // whatever anyone else in the split owes is between them.
      const theirShare = e.splits.find((s) => s.memberId === e.paidBy)?.amountPaise ?? 0;
      const pair = bucket(e.paidBy);
      pair.netPaise -= myShare;
      pair.lines.push({
        kind: 'expense',
        id: e.id,
        date: e.date,
        categoryName: e.categoryName,
        description: e.description,
        iPaid: false,
        totalPaise: e.totalPaise,
        theirSharePaise: theirShare,
        mySharePaise: myShare,
        deltaPaise: -myShare,
      });
    }
  }

  for (const t of settlements) {
    if (t.fromMember !== myId && t.toMember !== myId) continue;

    const them = t.fromMember === myId ? t.toMember : t.fromMember;
    // I paid them: I owe them less, so the net moves toward them owing me.
    const delta = t.fromMember === myId ? t.amountPaise : -t.amountPaise;
    const pair = bucket(them);
    pair.netPaise += delta;
    pair.lines.push({
      kind: 'settlement',
      id: t.id,
      date: t.date,
      categoryName: 'Payment',
      description: t.fromMember === myId ? 'You paid them' : 'They paid you',
      iPaid: t.fromMember === myId,
      totalPaise: t.amountPaise,
      theirSharePaise: t.amountPaise,
      mySharePaise: 0,
      deltaPaise: delta,
    });
  }

  for (const pair of byMember.values()) {
    // Before the display sort: routing is a running total, so it has to be
    // computed in the order the money actually moved.
    annotateRouting(pair);
    // Newest first: the thing you just added is the thing you are checking.
    pair.lines.sort((a, b) => b.date.localeCompare(a.date));
  }

  // Biggest debt to me first, then biggest I owe. Ties by id so the order
  // never reshuffles on a refresh -- the same reasoning as settle.ts:14-16.
  return [...byMember.values()].sort(
    (a, b) => b.netPaise - a.netPaise || a.memberId.localeCompare(b.memberId)
  );
}

/**
 * The last moment every balance in the household was exactly zero, or null if
 * there never was one (or the rows carry no timestamps).
 *
 * Why this exists: pairwise nets are all-time, and settling up through the
 * plan clears BALANCES without clearing pairs. When Madhav pays Vinod what he
 * owed Lee, everybody lands on zero -- but pairwise Madhav still "owes" Lee
 * and Lee still "owes" Vinod, the same amount, forever. After a full settle-up
 * that showed people a "You owe Vinod Rs 375" for money nobody owed, and it
 * never went away.
 *
 * Once everyone is square there is nothing left to explain about the past, so
 * the pairwise view starts again from that point (sinceLastSquare below).
 *
 * The reconciliation in assertPairwiseReconciles survives this exactly: my
 * balance at that moment was zero, so the events after it sum to my whole
 * balance -- the same algebra as before, starting from a zero.
 *
 * Replayed from the ledger AS IT IS NOW, not as it was: an expense voided
 * after the settle-up is simply absent, and if that means the household was
 * never really at zero then, an earlier zero is found (or none). That can only
 * show more history than necessary, never a wrong total.
 *
 * Rows sharing a timestamp are applied together before checking, so a
 * settle-up recorded in one statement is never half-counted.
 */
export function lastSquaredAt(
  expenses: ExpenseLike[],
  settlements: SettlementLike[]
): string | null {
  type Event = { t: number; at: string; deltas: [string, Paise][] };
  const events: Event[] = [];

  for (const e of expenses) {
    if (!e.at) return null;
    const deltas: [string, Paise][] = [[e.paidBy, e.totalPaise]];
    for (const s of e.splits) deltas.push([s.memberId, -s.amountPaise]);
    events.push({ t: Date.parse(e.at), at: e.at, deltas });
  }
  for (const s of settlements) {
    if (!s.at) return null;
    // Same signs as member_balance(): paying in raises your balance.
    events.push({
      t: Date.parse(s.at),
      at: s.at,
      deltas: [[s.fromMember, s.amountPaise], [s.toMember, -s.amountPaise]],
    });
  }
  if (events.some((e) => Number.isNaN(e.t))) return null;

  events.sort((a, b) => a.t - b.t);

  const balance = new Map<string, Paise>();
  let nonZero = 0;
  let squared: string | null = null;

  for (let i = 0; i < events.length; i++) {
    for (const [memberId, delta] of events[i].deltas) {
      const before = balance.get(memberId) ?? 0;
      const after = before + delta;
      balance.set(memberId, after);
      if (before === 0 && after !== 0) nonZero += 1;
      if (before !== 0 && after === 0) nonZero -= 1;
    }
    const lastOfGroup = i === events.length - 1 || events[i + 1].t !== events[i].t;
    if (lastOfGroup && nonZero === 0) squared = events[i].at;
  }

  return squared;
}

/**
 * Only what entered the ledger after everyone was last square. Passing the
 * result to pairwiseNets() is what the Settle screen shows.
 */
export function sinceLastSquare(
  expenses: ExpenseLike[],
  settlements: SettlementLike[]
): { expenses: ExpenseLike[]; settlements: SettlementLike[]; squaredAt: string | null } {
  const squaredAt = lastSquaredAt(expenses, settlements);
  if (squaredAt === null) return { expenses, settlements, squaredAt };

  const cutoff = Date.parse(squaredAt);
  const after = (at: string | undefined) => !!at && Date.parse(at) > cutoff;

  return {
    expenses: expenses.filter((e) => after(e.at)),
    settlements: settlements.filter((s) => after(s.at)),
    squaredAt,
  };
}

export type Routing = {
  /** Cleared a debt between these two people. */
  directPaise: Paise;
  /** Went to the payee to pass on to somebody else. */
  routedPaise: Paise;
};

/**
 * Split one payment into the part that was really between these two people and
 * the part that was only passing through.
 *
 * This is the arithmetic behind the complaint this module was extended for.
 * simplifyDebts() plans from HOUSEHOLD balances, pairing the biggest debtor
 * with the biggest creditor, so the amount it asks someone for is their whole
 * balance -- not what they owe the person it names. Madhav owed Mani Rs
 * 1,182.33 and the plan told him to pay Rs 1,590.75, because the other Rs
 * 408.42 was his debt to Lee and Vinod travelling through Mani. Both screens
 * were telling the truth and neither said this, so it read to both of them as
 * Madhav having paid too much.
 *
 * `debtPaise` is what the payer owed the payee immediately beforehand. A payer
 * who owed nothing routes the whole amount; one who owed more than they paid
 * routes none of it.
 */
export function splitPayment(debtPaise: Paise, amountPaise: Paise): Routing {
  const directPaise = Math.max(0, Math.min(debtPaise, amountPaise));
  return { directPaise, routedPaise: amountPaise - directPaise };
}

/**
 * Fill in directPaise/routedPaise on every settlement in a pair.
 *
 * Replays the pair forwards and asks, at each payment, what the payer owed the
 * payee at that moment. That reconstruction is the only way to answer this for
 * payments already in the ledger -- record_settlement stores the amount and
 * nothing about where it came from (0029), and the whole point of this change
 * is that Mani can see it for the payment that already happened.
 *
 * SAME-DAY ORDER IS A CONVENTION, and has to be: settled_on and expense_date
 * are both DATEs with no time of day. Expenses sort before payments on the
 * same date, because a payment answers the state of the ledger as it stood.
 * Ties break by id so the answer never reshuffles between refreshes, the same
 * reasoning as settle.ts:14-16.
 *
 * The attribution is approximate in one case: an expense BACKDATED to before a
 * payment that was recorded after it moves the debt this replay sees. The split
 * still sums to the amount paid -- asserted below -- so nothing on screen can
 * be wrong, but which side of the line a few rupees fall on can shift.
 */
function annotateRouting(pair: PairNet): void {
  const chronological = [...pair.lines].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.kind === 'settlement') - Number(b.kind === 'settlement') ||
      a.id.localeCompare(b.id)
  );

  // Positive means they owe me, the same sign convention as netPaise.
  let running = 0;

  for (const line of chronological) {
    if (line.kind === 'settlement') {
      const debtPaise = line.iPaid ? -running : running;
      const split = splitPayment(debtPaise, line.totalPaise);
      line.directPaise = split.directPaise;
      line.routedPaise = split.routedPaise;
    }
    running += line.deltaPaise;
  }
}

export type PairRouting = {
  /** Arrived through me, for somebody else. Never negative. */
  receivedPaise: Paise;
  /** I sent through them, for somebody else. Never negative. */
  sentPaise: Paise;
};

/** Everything that only passed through this pair, both directions. */
export function pairRouting(pair: PairNet): PairRouting {
  const out: PairRouting = { receivedPaise: 0, sentPaise: 0 };

  for (const line of pair.lines) {
    if (line.kind !== 'settlement' || !line.routedPaise) continue;
    if (line.iPaid) out.sentPaise += line.routedPaise;
    else out.receivedPaise += line.routedPaise;
  }

  return out;
}

/**
 * A split that does not add up to the payment would put a figure on screen
 * that no bank statement agrees with. Cheap to check, so it is checked.
 */
export function assertRoutingSplitsPayments(pair: PairNet): void {
  for (const line of pair.lines) {
    if (line.kind !== 'settlement') continue;
    const direct = line.directPaise ?? 0;
    const routed = line.routedPaise ?? 0;
    if (direct < 0 || routed < 0 || direct + routed !== line.totalPaise) {
      throw new Error(
        `Payment ${line.id} splits into ${direct} + ${routed} paise, not ${line.totalPaise}`
      );
    }
  }
}

/**
 * The invariant that keeps this view honest.
 *
 * Every pairwise net I hold, summed, must equal my balance in
 * member_balances -- exactly. It holds algebraically: summing over every
 * counterparty collapses to (everything I paid for others) minus (my share of
 * everything others paid for), which is the expense half of member_balance(),
 * and settlements net one for one.
 *
 * It is asserted rather than assumed because this app now has THREE views of
 * the same money -- balances, the settle plan, and this -- and every previous
 * bug of consequence in it came from two such views drifting apart
 * (migrations 0020 and 0024 exist for exactly that reason).
 */
export function assertPairwiseReconciles(nets: PairNet[], myBalancePaise: Paise): void {
  const sum = nets.reduce((acc, n) => acc + n.netPaise, 0);
  if (sum !== myBalancePaise) {
    throw new Error(
      `Pairwise totals ${sum} paise but the balance is ${myBalancePaise} paise`
    );
  }
}

/** Every line in a pair must add up to the net it is explaining. */
export function assertLinesExplainNet(pair: PairNet): void {
  const sum = pair.lines.reduce((acc, l) => acc + l.deltaPaise, 0);
  if (sum !== pair.netPaise) {
    throw new Error(
      `Lines for ${pair.memberId} total ${sum} paise but the net is ${pair.netPaise} paise`
    );
  }
}

/**
 * The pair statement as plain rows, ready for toCsv().
 *
 * Pure, and here rather than in backup.ts, because backup.ts imports
 * expo-file-system and so cannot be loaded by the domain tests. The thing worth
 * testing about a statement is that its running total lands on the net it
 * claims — that is the whole point of the file.
 */
export const PAIR_STATEMENT_HEADERS = [
  'date',
  'type',
  'category',
  'description',
  'paid_by',
  'expense_total',
  'their_share',
  'my_share',
  'change',
  'running_net',
];

export function pairStatementRows(
  pair: PairNet,
  myName: string,
  theirName: string,
  amount: (paise: Paise) => string
): unknown[][] {
  // Oldest first: a running total only reads as a story forwards.
  const lines = [...pair.lines].sort((a, b) => a.date.localeCompare(b.date));

  const rows: unknown[][] = [];
  let running = 0;

  for (const l of lines) {
    running += l.deltaPaise;
    rows.push([
      l.date,
      l.kind,
      l.categoryName,
      l.description ?? '',
      l.iPaid ? myName : theirName,
      l.kind === 'expense' ? amount(l.totalPaise) : '',
      amount(l.theirSharePaise),
      amount(l.mySharePaise),
      amount(l.deltaPaise),
      amount(running),
    ]);
  }

  rows.push([
    '',
    'total',
    '',
    running >= 0 ? `${theirName} owes ${myName}` : `${myName} owes ${theirName}`,
    '',
    '',
    '',
    '',
    '',
    amount(Math.abs(pair.netPaise)),
  ]);

  return rows;
}

export type PairSummary = {
  /** Their share of things I paid for. */
  iCoveredPaise: Paise;
  /** My share of things they paid for. */
  theyCoveredPaise: Paise;
  /** Confirmed payments between us, SIGNED: positive means they owe me more. */
  settledNetPaise: Paise;
  expenseCount: number;
  settlementCount: number;
};

/**
 * The net, decomposed into the subtraction it actually is.
 *
 * "You owe Mani Rs 21.17" is an answer with no working. These three figures are
 * the working, and they are signed so the reader can do the arithmetic:
 *
 *   iCovered - theyCovered + settledNet == net
 *
 * An unsigned settlement total would break that the moment money had moved in
 * both directions, which is exactly when somebody is most likely to be checking.
 */
export function pairSummary(pair: PairNet): PairSummary {
  const out: PairSummary = {
    iCoveredPaise: 0,
    theyCoveredPaise: 0,
    settledNetPaise: 0,
    expenseCount: 0,
    settlementCount: 0,
  };

  for (const l of pair.lines) {
    if (l.kind === 'settlement') {
      out.settledNetPaise += l.deltaPaise;
      out.settlementCount += 1;
    } else if (l.iPaid) {
      out.iCoveredPaise += l.theirSharePaise;
      out.expenseCount += 1;
    } else {
      out.theyCoveredPaise += l.mySharePaise;
      out.expenseCount += 1;
    }
  }

  return out;
}

/** The three figures on screen must subtract to the number above them. */
export function assertSummaryExplainsNet(summary: PairSummary, netPaise: Paise): void {
  const sum =
    summary.iCoveredPaise - summary.theyCoveredPaise + summary.settledNetPaise;
  if (sum !== netPaise) {
    throw new Error(`Summary totals ${sum} paise but the net is ${netPaise} paise`);
  }
}
