import type { Paise } from './money';

export type BalanceLike = { memberId: string; balancePaise: Paise };
export type Transfer = { from: string; to: string; amountPaise: Paise };

/**
 * Reduce a set of balances to the fewest transfers that clear them.
 *
 * With four people there are up to six pairwise debts; this collapses them to
 * at most three payments. Greedy largest-debtor-against-largest-creditor is
 * not provably minimal in general (that problem is NP-hard), but for a
 * household it produces the obvious answer and never exceeds n-1 transfers.
 *
 * Ties are broken by memberId so the same balances always produce the same
 * plan — nobody should see the instructions reshuffle on a refresh.
 */
export function simplifyDebts(balances: BalanceLike[]): Transfer[] {
  const byAmountThenId = (a: { id: string; amt: number }, b: { id: string; amt: number }) =>
    b.amt - a.amt || a.id.localeCompare(b.id);

  const creditors = balances
    .filter((b) => b.balancePaise > 0)
    .map((b) => ({ id: b.memberId, amt: b.balancePaise }))
    .sort(byAmountThenId);

  const debtors = balances
    .filter((b) => b.balancePaise < 0)
    .map((b) => ({ id: b.memberId, amt: -b.balancePaise }))
    .sort(byAmountThenId);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amt, creditors[j].amt);

    if (amount > 0) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amountPaise: amount });
      debtors[i].amt -= amount;
      creditors[j].amt -= amount;
    }

    if (debtors[i].amt === 0) i += 1;
    if (creditors[j].amt === 0) j += 1;
  }

  return transfers;
}

/**
 * Every transfer plan must leave everybody at zero. If this ever throws, the
 * balances themselves didn't sum to zero — which means a bug upstream in the
 * ledger, not in the simplification.
 */
export function assertSettles(balances: BalanceLike[], transfers: Transfer[]): void {
  const net = new Map<string, number>(balances.map((b) => [b.memberId, b.balancePaise]));

  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0) + t.amountPaise);
    net.set(t.to, (net.get(t.to) ?? 0) - t.amountPaise);
  }

  for (const [memberId, remaining] of net) {
    if (remaining !== 0) {
      throw new Error(`Settlement plan leaves ${memberId} at ${remaining} paise, not zero`);
    }
  }
}
