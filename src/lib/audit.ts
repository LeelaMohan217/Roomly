/**
 * Reading the audit trail.
 *
 * audit_log is written by triggers on expenses and settlements and carries the
 * whole row before and after, as JSONB. Nothing in the app read it until now,
 * even though the Owner tools screen promises "every edit you make is recorded
 * and visible to everyone" -- so the guarantee existed in Postgres and nowhere
 * a person could see it.
 *
 * The interesting part is not that a row was created -- the notification feed
 * already says that -- it is what CHANGED. So this module's job is turning two
 * JSONB blobs into "Amount 1,200.00 -> 1,800.00", and nothing else.
 *
 * Pure functions, kept out of the screen so they can be tested. The trigger
 * writes only three action values (see write_audit in 0002_invariants.sql):
 * 'created', 'voided', and 'updated' for everything else -- which means an
 * un-voiding arrives as 'updated' and has to be recognised from the payload.
 */

export type AuditRecord = {
  entityType: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/** What a person would say happened, rather than what SQL called it. */
export type AuditKind = 'added' | 'edited' | 'deleted' | 'restored';

export function auditKind(r: AuditRecord): AuditKind {
  if (r.action === 'created') return 'added';
  if (r.action === 'voided') return 'deleted';

  // Restoring a deleted expense is an UPDATE that clears voided_at, so the
  // trigger records it as 'updated'. Only the payload can tell them apart.
  const wasVoided = !!r.before?.voided_at;
  const isVoided = !!r.after?.voided_at;
  if (wasVoided && !isVoided) return 'restored';
  if (!wasVoided && isVoided) return 'deleted';

  return 'edited';
}

export type Change = { label: string; from: string; to: string };

type Formatters = {
  money: (paise: number) => string;
  category: (id: string) => string;
  date: (iso: string) => string;
  member: (id: string) => string;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Only the fields worth reporting, and only where they actually differ.
 *
 * `updated_at` and `rev` change on every edit and mean nothing to a reader, so
 * they are deliberately not compared -- listing them would bury the one line
 * that matters.
 */
export function changesOf(r: AuditRecord, fmt: Formatters): Change[] {
  const before = r.before ?? {};
  const after = r.after ?? {};
  const out: Change[] = [];

  // Expenses use total_paise, settlements amount_paise.
  for (const key of ['total_paise', 'amount_paise']) {
    const a = num(before[key]);
    const b = num(after[key]);
    if (a !== null && b !== null && a !== b) {
      out.push({ label: 'Amount', from: fmt.money(a), to: fmt.money(b) });
    }
  }

  const catA = str(before.category_id);
  const catB = str(after.category_id);
  if (catA && catB && catA !== catB) {
    out.push({ label: 'Category', from: fmt.category(catA), to: fmt.category(catB) });
  }

  for (const key of ['expense_date', 'settled_on']) {
    const a = str(before[key]);
    const b = str(after[key]);
    if (a && b && a !== b) {
      out.push({ label: 'Date', from: fmt.date(a), to: fmt.date(b) });
    }
  }

  const descA = str(before.description);
  const descB = str(after.description);
  if (descA !== descB && (descA || descB)) {
    out.push({ label: 'Note', from: descA ?? 'none', to: descB ?? 'none' });
  }

  const payerA = str(before.paid_by);
  const payerB = str(after.paid_by);
  if (payerA && payerB && payerA !== payerB) {
    out.push({ label: 'Paid by', from: fmt.member(payerA), to: fmt.member(payerB) });
  }

  // ---- members, categories and recurring bills (migration 0021) ----
  // Without these, a rename or a pause shows as "changed" with nothing under
  // it, which is worse than not logging it at all.

  const nameA = str(before.display_name) ?? str(before.name);
  const nameB = str(after.display_name) ?? str(after.name);
  if (nameA && nameB && nameA !== nameB) {
    out.push({ label: 'Name', from: nameA, to: nameB });
  }

  const roleA = str(before.role);
  const roleB = str(after.role);
  if (roleA && roleB && roleA !== roleB) {
    out.push({ label: 'Role', from: roleA, to: roleB });
  }

  // Moving out and coming back, which the ledger cares about a great deal.
  const leftA = str(before.left_on);
  const leftB = str(after.left_on);
  if (leftA !== leftB) {
    if (leftB) out.push({ label: 'Moved out', from: 'living here', to: fmt.date(leftB) });
    else if (leftA) out.push({ label: 'Moved back in', from: fmt.date(leftA), to: 'living here' });
  }

  // A placeholder becoming a real person.
  if (!str(before.user_id) && str(after.user_id)) {
    out.push({ label: 'Account', from: 'not claimed', to: 'claimed' });
  }

  const kindA = str(before.kind);
  const kindB = str(after.kind);
  if (kindA && kindB && kindA !== kindB) {
    out.push({ label: 'Splits as', from: kindA, to: kindB });
  }

  const awayA = before.respects_away_calendar;
  const awayB = after.respects_away_calendar;
  if (typeof awayA === 'boolean' && typeof awayB === 'boolean' && awayA !== awayB) {
    out.push({
      label: 'Away calendar',
      from: awayA ? 'respected' : 'ignored',
      to: awayB ? 'respected' : 'ignored',
    });
  }

  const archA = before.is_archived;
  const archB = after.is_archived;
  if (typeof archA === 'boolean' && typeof archB === 'boolean' && archA !== archB) {
    out.push({ label: archB ? 'Archived' : 'Unarchived', from: archA ? 'yes' : 'no', to: archB ? 'yes' : 'no' });
  }

  const activeA = before.is_active;
  const activeB = after.is_active;
  if (typeof activeA === 'boolean' && typeof activeB === 'boolean' && activeA !== activeB) {
    out.push({ label: 'Status', from: activeA ? 'active' : 'paused', to: activeB ? 'active' : 'paused' });
  }

  const dayA = num(before.day_of_month);
  const dayB = num(after.day_of_month);
  if (dayA !== null && dayB !== null && dayA !== dayB) {
    out.push({ label: 'Posts on day', from: String(dayA), to: String(dayB) });
  }

  const modeA = str(before.mode);
  const modeB = str(after.mode);
  if (modeA && modeB && modeA !== modeB) {
    out.push({
      label: 'Amount',
      from: modeA === 'confirm' ? 'varies' : 'fixed',
      to: modeB === 'confirm' ? 'varies' : 'fixed',
    });
  }

  return out;
}

/** What the entry is about, in words, from the trigger's table name. */
export function entityLabel(entityType: string): string {
  switch (entityType) {
    case 'expenses':
      return 'an expense';
    case 'settlements':
      return 'a payment';
    case 'members':
      return 'a housemate';
    case 'categories':
      return 'a category';
    case 'recurring_expenses':
      return 'a recurring bill';
    default:
      return entityType;
  }
}

/** The name of the thing, when the row carries one. Lets a row read
 *  "Mohan renamed a category" AND show which one. */
export function subjectOf(r: AuditRecord): string | null {
  const src = r.after ?? r.before ?? {};
  return str(src.display_name) ?? str(src.name) ?? null;
}

/** The amount an entry is about, for the figure on the right of the row. */
export function amountOf(r: AuditRecord): number | null {
  const src = r.after ?? r.before ?? {};
  return num(src.total_paise) ?? num(src.amount_paise);
}
