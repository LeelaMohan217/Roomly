import { check, eq, noThrow, report, suite, throws } from './harness.ts';
import { formatPaise, paiseToRupees, parseAmount, rupeesToPaise } from '../src/lib/money.ts';
import {
  assertLinesExplainNet,
  assertPairwiseReconciles,
  assertRoutingSplitsPayments,
  assertSummaryExplainsNet,
  pairRouting,
  pairStatementRows,
  pairSummary,
  lastSquaredAt,
  pairwiseNets,
  sinceLastSquare,
  splitPayment,
  PAIR_STATEMENT_HEADERS,
  type ExpenseLike,
  type SettlementLike,
} from '../src/lib/pairwise.ts';
import {
  assertBalanced,
  defaultParticipants,
  isPresent,
  isResident,
  splitEqually,
} from '../src/lib/split.ts';
import { assertSettles, simplifyDebts } from '../src/lib/settle.ts';
import {
  addDays,
  daysBetween,
  daysInMonth,
  formatRange,
  isoOf,
  withinRange,
} from '../src/lib/dates.ts';
import { ICON_SLUGS, iconFor } from '../src/lib/icons.ts';
import { evaluate, toAmountString } from '../src/lib/calc.ts';
import { humanError } from '../src/lib/errors.ts';
import { amountOf, auditKind, changesOf, entityLabel, subjectOf } from '../src/lib/audit.ts';
import { backupFilename, csvAmount, csvCell, toCsv } from '../src/lib/csv.ts';

// ------------------------------- money -------------------------------
suite('money');
eq('rupeesToPaise rounds', rupeesToPaise(12.345), 1235);
eq('paiseToRupees', paiseToRupees(12345), 123.45);
eq('parse plain', parseAmount('50'), 5000);
eq('parse decimals', parseAmount('1,234.50'), 123450);
eq('parse rejects 3dp', parseAmount('12.999'), null);
eq('parse rejects letters', parseAmount('abc'), null);
eq('parse rejects empty', parseAmount(''), null);

// Some Android keyboards emit ',' on the decimal key. Stripping it turned
// "12,50" into Rs 1,250.00 — a hundredfold error, typed by hand, in money.
// A trailing comma with one or two digits is a decimal mark; anything else is
// still a thousands separator.
eq('comma as decimal mark', parseAmount('12,50'), 1250);
eq('comma with one decimal digit', parseAmount('12,5'), 1250);
eq('comma as thousands separator', parseAmount('1,000'), 100000);
eq('indian grouping still groups', parseAmount('1,23,456'), 12345600);
eq('a dot present means commas group', parseAmount('1,234.50'), 123450);
eq('parse trims whitespace', parseAmount('  50  '), 5000);
eq('parse rejects negative', parseAmount('-50'), null);
eq('parse leading dot', parseAmount('.5'), 50);
eq('parse trailing dot', parseAmount('50.'), 5000);
eq('parse rejects scientific notation', parseAmount('1e3'), null);
eq('parse zero returns null', parseAmount('0'), null);
check('formatPaise renders the amount', formatPaise(12345).includes('123'), formatPaise(12345));
// Paise must always be visible, so a figure is never ambiguously "tidy".
check('whole amount still shows paise', formatPaise(70000).endsWith('.00'), formatPaise(70000));
check('split amount shows its paise', formatPaise(23334).endsWith('.34'), formatPaise(23334));
check('one paisa is not swallowed', formatPaise(1).endsWith('0.01'), formatPaise(1));
check('zero shows paise too', formatPaise(0).endsWith('.00'), formatPaise(0));
check('large amount keeps grouping and paise', formatPaise(18889066).endsWith('.66'), formatPaise(18889066));
// The invariant that matters: what we display can be read back exactly.
check(
  'format then parse round-trips',
  parseAmount(formatPaise(4137666)) === 4137666,
  formatPaise(4137666) + ' -> ' + parseAmount(formatPaise(4137666))
);
let moneyFuzz = '';
for (let i = 0; i < 3000 && !moneyFuzz; i++) {
  const paise = 1 + Math.floor(Math.random() * 50_000_000);
  if (parseAmount(formatPaise(paise)) !== paise) moneyFuzz = String(paise) + ' -> ' + formatPaise(paise);
}
check('fuzz: 3000 amounts survive format then parse', !moneyFuzz, moneyFuzz);
check('formatPaise handles zero', formatPaise(0).length > 0, formatPaise(0));

// ------------------------------- split -------------------------------
suite('split');
const bal = (t: number, ids: string[], payer?: string) => splitEqually(t, ids, payer);
const sum = (s: { amountPaise: number }[]) => s.reduce((a, x) => a + x.amountPaise, 0);

eq(
  '100/3 remainder goes to payer',
  bal(10000, ['m', 'r', 'a'], 'm').map((s) => s.amountPaise),
  [3334, 3333, 3333]
);
eq(
  'requested order preserved',
  bal(10000, ['m', 'r', 'a'], 'r').map((s) => s.memberId),
  ['m', 'r', 'a']
);
eq(
  'payer gets the extra paisa even mid-list',
  bal(10000, ['m', 'r', 'a'], 'r').find((s) => s.memberId === 'r')!.amountPaise,
  3334
);
check('1 paisa across 4 still sums', sum(bal(1, ['a', 'b', 'c', 'd'], 'a')) === 1);
check('unknown payer still balances', sum(bal(10000, ['a', 'b', 'c'], 'zzz')) === 10000);
throws('rejects empty participant list', () => bal(100, []));
throws('rejects zero total', () => bal(0, ['a']));
throws('rejects negative total', () => bal(-100, ['a']));
throws('rejects fractional paise', () => bal(10.5, ['a']));
// A duplicated participant would silently under-charge the household.
check(
  'duplicate participant ids still sum to total',
  sum(bal(10000, ['a', 'a', 'b'], 'a')) === 10000,
  'sum was ' + sum(bal(10000, ['a', 'a', 'b'], 'a'))
);
noThrow('assertBalanced accepts a good split', () =>
  assertBalanced(10000, bal(10000, ['a', 'b'], 'a'))
);
throws('assertBalanced rejects a short split', () =>
  assertBalanced(10000, [{ memberId: 'a', amountPaise: 1 }])
);

suite('split / away rules');
const members = [
  { id: 'm', joinedOn: '2026-01-01', leftOn: null },
  { id: 'r', joinedOn: '2026-01-01', leftOn: null },
  { id: 'k', joinedOn: '2026-01-01', leftOn: null },
];
const away = [{ memberId: 'k', startDate: '2026-08-05', endDate: '2026-08-15' }];
const consumption = { respectsAwayCalendar: true };
const fixed = { respectsAwayCalendar: false };

eq('consumption excludes an away member', defaultParticipants(members, consumption, '2026-08-10', away), ['m', 'r']);
eq('fixed cost includes an away member', defaultParticipants(members, fixed, '2026-08-10', away), ['m', 'r', 'k']);
eq('away start date is inclusive', defaultParticipants(members, consumption, '2026-08-05', away), ['m', 'r']);
eq('away end date is inclusive', defaultParticipants(members, consumption, '2026-08-15', away), ['m', 'r']);
eq('day after the trip they are back', defaultParticipants(members, consumption, '2026-08-16', away), ['m', 'r', 'k']);
eq(
  'open-ended trip still excludes',
  defaultParticipants(members, consumption, '2099-01-01', [
    { memberId: 'k', startDate: '2026-08-05', endDate: null },
  ]),
  ['m', 'r']
);
eq(
  'someone who had not joined is excluded',
  defaultParticipants([{ id: 'x', joinedOn: '2026-09-01', leftOn: null }], fixed, '2026-08-10', []),
  []
);
eq(
  'someone who had left is excluded',
  defaultParticipants([{ id: 'x', joinedOn: '2026-01-01', leftOn: '2026-07-31' }], fixed, '2026-08-10', []),
  []
);
// Everyone away on a consumption day must not produce an empty split.
eq(
  'everyone away falls back to all residents',
  defaultParticipants(
    members,
    consumption,
    '2026-08-10',
    members.map((m) => ({ memberId: m.id, startDate: '2026-08-01', endDate: '2026-08-31' }))
  ),
  ['m', 'r', 'k']
);
check('isPresent is true with no trips', isPresent('m', '2026-08-10', []));
check('isResident on the join date itself', isResident({ id: 'a', joinedOn: '2026-08-10', leftOn: null }, '2026-08-10'));

// ------------------------------- settle -------------------------------
suite('settle');
const smoke = [
  { memberId: 'ravi', balancePaise: 1500000 },
  { memberId: 'mohan', balancePaise: -496667 },
  { memberId: 'kiran', balancePaise: -500000 },
  { memberId: 'arjun', balancePaise: -503333 },
];
const plan = simplifyDebts(smoke);
eq('produces n-1 transfers', plan.length, 3);
check('everyone pays the single creditor', plan.every((t) => t.to === 'ravi'));
noThrow('plan settles the ledger exactly', () => assertSettles(smoke, plan));
eq('all-zero balances need no transfers', simplifyDebts([{ memberId: 'a', balancePaise: 0 }]).length, 0);
eq(
  'deterministic regardless of input order',
  JSON.stringify(simplifyDebts(smoke.map((b) => ({ ...b })))),
  JSON.stringify(simplifyDebts([...smoke].reverse().map((b) => ({ ...b }))))
);
// A ledger that does not sum to zero is a bug upstream and must be caught.
throws('non-zero-sum ledger is rejected', () => {
  const broken = [{ memberId: 'a', balancePaise: 100 }];
  assertSettles(broken, simplifyDebts(broken));
});

let fuzzFail = '';
for (let i = 0; i < 3000 && !fuzzFail; i++) {
  const n = 2 + Math.floor(Math.random() * 7);
  const bs: { memberId: string; balancePaise: number }[] = [];
  let run = 0;
  for (let j = 0; j < n - 1; j++) {
    const v = Math.floor(Math.random() * 2000000) - 1000000;
    bs.push({ memberId: 'm' + j, balancePaise: v });
    run += v;
  }
  bs.push({ memberId: 'm' + (n - 1), balancePaise: -run });
  const p = simplifyDebts(bs);
  try {
    assertSettles(bs, p);
  } catch (e) {
    fuzzFail = (e as Error).message;
  }
  if (p.length > n - 1) fuzzFail = p.length + ' transfers for ' + n + ' people';
}
check('fuzz: 3000 zero-sum ledgers settle exactly', !fuzzFail, fuzzFail);

// ------------------------------- dates -------------------------------
suite('dates');
eq('leap February 2028', daysInMonth(2028, 2), 29);
eq('non-leap February 2026', daysInMonth(2026, 2), 28);
eq('century rule 1900', daysInMonth(1900, 2), 28);
eq('400-year rule 2000', daysInMonth(2000, 2), 29);
eq('year rollover', addDays('2026-12-31', 1), '2027-01-01');
eq('leap day rollover', addDays('2028-02-28', 1), '2028-02-29');
eq('same day counts as one', daysBetween('2026-09-05', '2026-09-05'), 1);
eq('inclusive span', daysBetween('2026-09-05', '2026-09-15'), 11);
eq('isoOf pads single digits', isoOf(2026, 3, 7), '2026-03-07');
check('withinRange handles open ended', withinRange('2099-01-01', '2026-09-05', null));
check('withinRange excludes the day after', !withinRange('2026-09-16', '2026-09-05', '2026-09-15'));

let dateFuzz = '';
for (let i = 0; i < 2000 && !dateFuzz; i++) {
  const y = 2024 + Math.floor(Math.random() * 6);
  const m = 1 + Math.floor(Math.random() * 12);
  const d = 1 + Math.floor(Math.random() * daysInMonth(y, m));
  const span = Math.floor(Math.random() * 400);
  const from = isoOf(y, m, d);
  if (daysBetween(from, addDays(from, span)) !== span + 1) dateFuzz = from + ' + ' + span;
}
check('fuzz: addDays and daysBetween agree', !dateFuzz, dateFuzz);
check('formatRange returns something for a single day', formatRange('2026-09-05', '2026-09-05').length > 0);

// ------------------------------- icons -------------------------------
suite('icons');
check('every slug resolves to a glyph', ICON_SLUGS.every((s) => iconFor(s).length > 0));
eq('unknown slug falls back to misc', iconFor('nope'), iconFor('misc'));
eq('null falls back to misc', iconFor(null), iconFor('misc'));
check(
  'no two categories share a glyph',
  new Set(ICON_SLUGS.map(iconFor)).size === ICON_SLUGS.length,
  ICON_SLUGS.length + ' slugs but ' + new Set(ICON_SLUGS.map(iconFor)).size + ' distinct glyphs'
);


// ------------------------------ calculator ------------------------------
suite('calculator');
eq('a lone number is itself', evaluate([120]), 120);
eq('adds left to right', evaluate([120, '+', 45, '+', 230]), 395);
eq('subtracts', evaluate([500, '-', 120]), 380);
eq('multiplies', evaluate([12, '×', 4]), 48);
eq('divides', evaluate([100, '÷', 4]), 25);
// Precedence is the thing a naive left-to-right calculator gets wrong.
eq('times binds tighter than plus', evaluate([2, '+', 3, '×', 4]), 14);
eq('divide binds tighter than minus', evaluate([20, '-', 10, '÷', 2]), 15);
eq('two multiplies chain', evaluate([2, '×', 3, '×', 4]), 24);
eq('mixed precedence', evaluate([10, '+', 2, '×', 3, '-', 4, '÷', 2]), 14);
// A half-typed expression must still show a running total.
eq('trailing operator is dropped', evaluate([120, '+']), 120);
eq('trailing operator mid-sum', evaluate([120, '+', 45, '-']), 165);
eq('empty is null', evaluate([]), null);
eq('a lone operator is null', evaluate(['+']), null);
eq('divide by zero is null', evaluate([5, '÷', 0]), null);
eq('divide by zero mid-expression', evaluate([1, '+', 5, '÷', 0]), null);
// Float artefacts must not reach the screen as 0.30000000000000004.
check(
  'point one plus point two rounds clean at 4dp',
  Number(evaluate([0.1, '+', 0.2])!.toFixed(4)) === 0.3
);

suite('calculator / handoff to an expense');
eq('whole number needs no decimals', toAmountString(395), '395');
eq('two decimals are kept', toAmountString(12.5), '12.50');
// parseAmount() refuses three decimals, so this must round here.
eq('three decimals are rounded', toAmountString(33.333), '33.33');
eq('rounds up at the halfway point', toAmountString(0.125), '0.13');
eq('null passes through', toAmountString(null), null);
eq('zero is not an amount', toAmountString(0), null);
eq('negative is not an amount', toAmountString(-50), null);
eq('a rounding-to-zero result is refused', toAmountString(0.004), null);
check('handoff output is always parseable', parseAmount(toAmountString(33.333)!) === 3333);


// ------------------------------ error messages ------------------------------
suite('errors');
// Messages our own RPCs raise are already English and must survive intact.
eq(
  'our own P0001 message passes through',
  humanError({ code: 'P0001', message: 'Only the owner can remove people from the household' }),
  'Only the owner can remove people from the household'
);
// Postgres internals must never reach a flatmate verbatim.
check(
  'RLS rejection is translated',
  !humanError({
    code: '42501',
    message: 'new row violates row-level security policy for table "expenses"',
  }).includes('row-level security')
);
check(
  'foreign key violation is translated',
  !humanError({
    code: '23503',
    message: 'insert or update on table "expense_splits" violates foreign key constraint',
  }).includes('constraint')
);
// Even with no code, jargon must be caught by the phrase filter.
check(
  'uncoded jargon still translated',
  !humanError({ message: 'duplicate key value violates unique constraint "x_pkey"' }).includes(
    'duplicate key'
  )
);
check(
  'schema names never leak',
  !humanError({ message: 'relation "public.members" does not exist' }).includes('members')
);
eq(
  'terse auth message is rewritten',
  humanError({ message: 'Invalid login credentials' }),
  'That email and password do not match.'
);
check(
  'offline says it will retry',
  humanError({ message: 'Network request failed' }).toLowerCase().includes('online')
);
// A genuinely human message with no jargon is left alone.
eq(
  'human message survives',
  humanError({ message: 'Email link is invalid or has expired' }),
  'Email link is invalid or has expired'
);
check('empty error still says something', humanError({}).length > 20);
check('null is handled', humanError(null).length > 20);
check('a bare string is handled', humanError('Settle up with Ravi first.') === 'Settle up with Ravi first.');
check('a stack trace is not shown', !humanError({ message: 'x'.repeat(500) }).includes('xxxx'));
// Supabase's email quota is the one error a flatmate will actually hit, and
// the raw text does not say what to do about it.
//
// This used to assert the word "confirmation", which pinned the old copy:
// "Ask Mohan to turn off email confirmation in Supabase". That named a person
// and a backend setting, inside the APK, to someone who can act on neither.
// What matters is that the message tells the READER something they can do.
check(
  'email rate limit says what to do',
  /try again/i.test(humanError({ message: 'Email rate limit exceeded' })),
  humanError({ message: 'Email rate limit exceeded' })
);

// No message shipped to a flatmate names the person who set the project up.
// Both of these were in errors.ts for the whole life of the app.
check(
  'no shipped error names a developer',
  !/Mohan/.test(
    [
      humanError({ message: 'Email rate limit exceeded' }),
      humanError({ message: 'email rate limit reached for this project' }),
      humanError({ message: 'something nobody has a mapping for' }),
    ].join(' ')
  ),
  'a personal name is still in a user-facing error'
);
check(
  'rate limit caught however it is worded',
  humanError({ message: 'email rate limit reached for this project' })
    .toLowerCase()
    .includes('hour')
);
check(
  '60 second throttle is plain',
  humanError({
    message: 'For security purposes, you can only request this after 60 seconds.',
  }) === 'Wait a minute and try again.'
);


// -------------------------------- audit trail --------------------------------
suite('audit');
const FMT = {
  money: (p: number) => 'Rs ' + (p / 100).toFixed(2),
  category: (id: string) => ({ c1: 'Groceries', c2: 'Rent' })[id] ?? id,
  date: (iso: string) => iso,
  member: (id: string) => ({ m1: 'Mohan', m2: 'Ravi' })[id] ?? id,
};

eq('insert reads as added', auditKind({ entityType: 'expenses', action: 'created', before: null, after: {} }), 'added');
eq(
  'void reads as deleted',
  auditKind({ entityType: 'expenses', action: 'voided', before: {}, after: { voided_at: 'x' } }),
  'deleted'
);
// The trigger only writes three actions, so un-voiding arrives as 'updated'.
eq(
  'clearing voided_at reads as restored',
  auditKind({ entityType: 'expenses', action: 'updated', before: { voided_at: 'x' }, after: { voided_at: null } }),
  'restored'
);
eq(
  'setting voided_at on an update still reads as deleted',
  auditKind({ entityType: 'expenses', action: 'updated', before: { voided_at: null }, after: { voided_at: 'x' } }),
  'deleted'
);
eq(
  'a plain change reads as edited',
  auditKind({ entityType: 'expenses', action: 'updated', before: { total_paise: 1 }, after: { total_paise: 2 } }),
  'edited'
);

const amountEdit = changesOf(
  { entityType: 'expenses', action: 'updated', before: { total_paise: 120000 }, after: { total_paise: 180000 } },
  FMT
);
eq('one change reported', amountEdit.length, 1);
eq('amount labelled', amountEdit[0].label, 'Amount');
eq('amount from', amountEdit[0].from, 'Rs 1200.00');
eq('amount to', amountEdit[0].to, 'Rs 1800.00');

eq(
  'category resolves to a name',
  changesOf({ entityType: 'expenses', action: 'updated', before: { category_id: 'c1' }, after: { category_id: 'c2' } }, FMT)[0].to,
  'Rent'
);
eq(
  'payer resolves to a name',
  changesOf({ entityType: 'expenses', action: 'updated', before: { paid_by: 'm1' }, after: { paid_by: 'm2' } }, FMT)[0].to,
  'Ravi'
);
eq(
  'settlements use amount_paise',
  changesOf({ entityType: 'settlements', action: 'updated', before: { amount_paise: 500 }, after: { amount_paise: 900 } }, FMT).length,
  1
);
// updated_at and rev change on every edit and would bury the real line.
eq(
  'noise fields are not reported',
  changesOf(
    { entityType: 'expenses', action: 'updated', before: { updated_at: 'a', rev: 1 }, after: { updated_at: 'b', rev: 2 } },
    FMT
  ).length,
  0
);
eq(
  'identical rows report nothing',
  changesOf({ entityType: 'expenses', action: 'updated', before: { total_paise: 5 }, after: { total_paise: 5 } }, FMT).length,
  0
);
eq(
  'a note added from nothing is reported',
  changesOf({ entityType: 'expenses', action: 'updated', before: { description: null }, after: { description: 'milk' } }, FMT)[0].to,
  'milk'
);
eq('amountOf prefers after', amountOf({ entityType: 'expenses', action: 'updated', before: { total_paise: 1 }, after: { total_paise: 2 } }), 2);
eq('amountOf falls back to before on a delete', amountOf({ entityType: 'expenses', action: 'voided', before: { total_paise: 7 }, after: null }), 7);
eq('amountOf handles neither', amountOf({ entityType: 'expenses', action: 'created', before: null, after: {} }), null);

suite('audit / members, categories, recurring');
const ch = (before: object, after: object) =>
  changesOf({ entityType: 'x', action: 'updated', before, after }, FMT);

eq('a rename is reported', ch({ display_name: 'Ravi' }, { display_name: 'Ravinder' })[0].to, 'Ravinder');
eq('a category rename uses name', ch({ name: 'Wifi' }, { name: 'Internet' })[0].to, 'Internet');
eq('a role change is reported', ch({ role: 'member' }, { role: 'owner' })[0].label, 'Role');
// left_on is the one that moves money, so it must never be silent.
eq('moving out is reported', ch({ left_on: null }, { left_on: '2026-09-01' })[0].label, 'Moved out');
eq('moving back in is reported', ch({ left_on: '2026-09-01' }, { left_on: null })[0].label, 'Moved back in');
eq('claiming an account is reported', ch({ user_id: null }, { user_id: 'u1' })[0].to, 'claimed');
eq('a kind change is reported', ch({ kind: 'consumption' }, { kind: 'fixed' })[0].label, 'Splits as');
eq(
  'away-calendar toggle is readable',
  ch({ respects_away_calendar: true }, { respects_away_calendar: false })[0].to,
  'ignored'
);
eq('archiving is reported', ch({ is_archived: false }, { is_archived: true })[0].label, 'Archived');
eq('pausing a bill is reported', ch({ is_active: true }, { is_active: false })[0].to, 'paused');
eq('changing the posting day is reported', ch({ day_of_month: 1 }, { day_of_month: 5 })[0].to, '5');
eq('fixed-to-varies is readable', ch({ mode: 'auto' }, { mode: 'confirm' })[0].to, 'varies');
// false is a real value, so a boolean toggle must not be skipped as falsy.
eq('false is not treated as absent', ch({ is_active: false }, { is_active: true }).length, 1);

eq('expenses label', entityLabel('expenses'), 'an expense');
eq('members label', entityLabel('members'), 'a housemate');
eq('recurring label', entityLabel('recurring_expenses'), 'a recurring bill');
eq('unknown table falls back to its name', entityLabel('widgets'), 'widgets');

eq('subject from a member row', subjectOf({ entityType: 'members', action: 'created', before: null, after: { display_name: 'Kiran' } }), 'Kiran');
eq('subject from a category row', subjectOf({ entityType: 'categories', action: 'created', before: null, after: { name: 'Rent' } }), 'Rent');
eq('subject falls back to before on a delete', subjectOf({ entityType: 'members', action: 'deleted', before: { display_name: 'Lee' }, after: null }), 'Lee');
eq('no subject on an expense', subjectOf({ entityType: 'expenses', action: 'created', before: null, after: { total_paise: 1 } }), null);


// ---------------------------------- csv ----------------------------------
suite('csv');
eq('plain text is untouched', csvCell('Groceries'), 'Groceries');
eq('empty for null', csvCell(null), '');
eq('empty for undefined', csvCell(undefined), '');
// The one that breaks a naive join(',') -- an expense called "Milk, 2L".
eq('a comma forces quotes', csvCell('Milk, 2L'), '"Milk, 2L"');
eq('quotes are doubled', csvCell('2L "full cream"'), '"2L ""full cream"""');
eq('both together', csvCell('Milk, 2L "full"'), '"Milk, 2L ""full"""');
const MULTILINE = ['line one', 'line two'].join(String.fromCharCode(10));
eq(
  'a newline forces quotes',
  csvCell(MULTILINE),
  String.fromCharCode(34) + MULTILINE + String.fromCharCode(34)
);
eq('padding is preserved by quoting', csvCell('  spaced  '), '"  spaced  "');

// Formula injection: descriptions are typed by housemates, so untrusted.
check('equals is neutralised', csvCell('=1+1').startsWith("'"), csvCell('=1+1'));
check('plus is neutralised', csvCell('+cmd').startsWith("'"), csvCell('+cmd'));
check('minus is neutralised', csvCell('-2+3').startsWith("'"), csvCell('-2+3'));
check('at is neutralised', csvCell('@SUM(A1)').startsWith("'"), csvCell('@SUM(A1)'));
const PAYLOAD = ['=cmd|' + String.fromCharCode(39) + '/c calc' + String.fromCharCode(39) + '!A1'].join('');
check(
  'a real attack payload is inert and still quoted',
  // One leading apostrophe is the whole defence: it makes the cell literal
  // text. No quoting is added because the payload contains apostrophes, not
  // commas or double quotes, so RFC 4180 does not require any.
  csvCell(PAYLOAD).startsWith("'=") && csvCell(PAYLOAD).includes('calc'),
  csvCell(PAYLOAD)
);
// A negative AMOUNT must not be mangled into text by the same rule, which is
// why amounts go through csvAmount and are never negative in this export.
eq('csvAmount is plain and summable', csvAmount(123456), '1234.56');
eq('csvAmount keeps two decimals', csvAmount(70000), '700.00');
eq('csvAmount handles zero', csvAmount(0), '0.00');

const csv = toCsv(['a', 'b'], [['1', 'x,y'], ['2', null]]);
check('has a BOM for Excel', csv.charCodeAt(0) === 0xfeff, 'first char ' + csv.charCodeAt(0));
check('uses CRLF', csv.includes(String.fromCharCode(13, 10)), JSON.stringify(csv.slice(0, 20)));
check('header first', csv.includes('a,b'), csv);
check('quoted field intact', csv.includes('"x,y"'), csv);
eq('bom can be turned off', toCsv(['a'], [], { bom: false }).charCodeAt(0), 97);
eq('row count', toCsv(['a'], [['1'], ['2']], { bom: false }).trim().split(String.fromCharCode(13, 10)).length, 3);

check(
  'filename is sortable and safe',
  /^roomly-room-502-\d{8}-\d{4}\.csv$/.test(backupFilename('Room 502', new Date(2026, 8, 1, 9, 5))),
  backupFilename('Room 502', new Date(2026, 8, 1, 9, 5))
);
check('odd household names still yield a filename', backupFilename('!!!', new Date(2026, 8, 1, 9, 5)).startsWith('roomly-roomly-'), backupFilename('!!!', new Date(2026, 8, 1, 9, 5)));

suite('pairwise / who owes whom before simplification');

// Two people, one expense each way. The classic double-count trap: my own
// share of my own expense must never appear.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Groceries', description: 'Milk',
      paidBy: 'me', totalPaise: 10000,
      splits: [{ memberId: 'me', amountPaise: 5000 }, { memberId: 'vinod', amountPaise: 5000 }],
    },
    {
      id: 'e2', date: '2026-09-02', categoryName: 'Groceries', description: 'Rice',
      paidBy: 'vinod', totalPaise: 4000,
      splits: [{ memberId: 'me', amountPaise: 2000 }, { memberId: 'vinod', amountPaise: 2000 }],
    },
  ];
  const nets = pairwiseNets('me', expenses, []);
  eq('one counterparty', nets.length, 1);
  eq('nets the two directions', nets[0].netPaise, 3000);
  eq('keeps a line per expense', nets[0].lines.length, 2);
  noThrow('lines explain the net', () => assertLinesExplainNet(nets[0]));
}

// An expense I am not part of at all must not create a relationship.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Rent', description: null,
      paidBy: 'vinod', totalPaise: 6000,
      splits: [{ memberId: 'vinod', amountPaise: 3000 }, { memberId: 'mani', amountPaise: 3000 }],
    },
  ];
  eq('an expense I am not in is ignored', pairwiseNets('me', expenses, []).length, 0);
}

// The away calendar means not everyone is in every split.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Groceries', description: null,
      paidBy: 'me', totalPaise: 9000,
      // vinod was away, so he is not in the split at all.
      splits: [{ memberId: 'me', amountPaise: 4500 }, { memberId: 'mani', amountPaise: 4500 }],
    },
  ];
  const nets = pairwiseNets('me', expenses, []);
  eq('only the present member owes', nets.length, 1);
  eq('and owes their share', nets[0].memberId, 'mani');
}

// A settlement moves the net one for one, in the right direction.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Groceries', description: null,
      paidBy: 'me', totalPaise: 10000,
      splits: [{ memberId: 'me', amountPaise: 5000 }, { memberId: 'vinod', amountPaise: 5000 }],
    },
  ];
  const paid: SettlementLike[] = [
    { id: 's1', date: '2026-09-03', fromMember: 'vinod', toMember: 'me', amountPaise: 5000 },
  ];
  eq('a confirmed settlement clears the debt', pairwiseNets('me', expenses, paid)[0].netPaise, 0);
  eq('and without it the debt stands', pairwiseNets('me', expenses, [])[0].netPaise, 5000);
  // Unconfirmed settlements are excluded by the CALLER (migration 0019), which
  // is the same thing as never passing them in.
  const other: SettlementLike[] = [
    { id: 's2', date: '2026-09-03', fromMember: 'mani', toMember: 'lee', amountPaise: 5000 },
  ];
  eq('a settlement between two others is ignored', pairwiseNets('me', expenses, other)[0].netPaise, 5000);
}

// THE INVARIANT. Every pairwise net I hold must sum to my balance, over random
// ledgers where not everyone is in every expense -- which is what the away
// calendar produces in real use.
{
  let fail = '';
  for (let i = 0; i < 3000 && !fail; i++) {
    const n = 2 + Math.floor(Math.random() * 4);
    const ids = Array.from({ length: n }, (_, j) => 'm' + j);
    const expenses: ExpenseLike[] = [];

    for (let e = 0; e < 1 + Math.floor(Math.random() * 8); e++) {
      // A random non-empty subset of the household shares this one.
      const present = ids.filter(() => Math.random() > 0.35);
      if (present.length === 0) present.push(ids[0]);
      const payer = ids[Math.floor(Math.random() * n)];

      // Split like the app does: equal shares, remainder to the payer first.
      const total = 1 + Math.floor(Math.random() * 500000);
      const base = Math.floor(total / present.length);
      let rem = total - base * present.length;
      const order = present.includes(payer)
        ? [payer, ...present.filter((p) => p !== payer)]
        : present;
      const amounts = new Map(order.map((id) => [id, base]));
      for (const id of order) {
        if (rem === 0) break;
        amounts.set(id, amounts.get(id)! + 1);
        rem -= 1;
      }

      expenses.push({
        id: 'e' + e, date: '2026-09-0' + ((e % 9) + 1), categoryName: 'X', description: null,
        paidBy: payer, totalPaise: total,
        splits: present.map((id) => ({ memberId: id, amountPaise: amounts.get(id)! })),
      });
    }

    const settlements: SettlementLike[] = [];
    for (let t = 0; t < Math.floor(Math.random() * 3); t++) {
      const a = ids[Math.floor(Math.random() * n)];
      const b = ids[Math.floor(Math.random() * n)];
      if (a === b) continue;
      settlements.push({
        id: 't' + t, date: '2026-09-10', fromMember: a, toMember: b,
        amountPaise: 1 + Math.floor(Math.random() * 100000),
      });
    }

    for (const me of ids) {
      // The balance exactly as member_balance() computes it.
      const paidOut = expenses.filter((e) => e.paidBy === me).reduce((a, e) => a + e.totalPaise, 0);
      const owed = expenses.reduce(
        (a, e) => a + (e.splits.find((s) => s.memberId === me)?.amountPaise ?? 0), 0);
      const sentOut = settlements.filter((t) => t.fromMember === me).reduce((a, t) => a + t.amountPaise, 0);
      const gotIn = settlements.filter((t) => t.toMember === me).reduce((a, t) => a + t.amountPaise, 0);
      const balance = paidOut - owed + sentOut - gotIn;

      const nets = pairwiseNets(me, expenses, settlements);
      try {
        assertPairwiseReconciles(nets, balance);
        for (const pair of nets) assertLinesExplainNet(pair);
      } catch (err) {
        fail = (err as Error).message;
        break;
      }
    }
  }
  check('3000 random ledgers: pairwise always sums to the balance', fail === '', fail);
}

suite('pairwise / starting again after everyone is square');

// The report this was built for. Lee is owed by Madhav and owes Vinod and Mani;
// the plan settles it by Madhav paying all three, so every BALANCE is zero --
// but all-time, Lee still "owes" Vinod and Mani and Madhav still "owes" Lee.
// After the settle-up, Lee should see only what was added since.
{
  const at = (h: number) => `2026-10-10T${String(h).padStart(2, '0')}:00:00.000+00:00`;
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-10-01', categoryName: 'Rent', description: null, at: at(1),
      paidBy: 'lee', totalPaise: 40000,
      splits: [{ memberId: 'lee', amountPaise: 10000 }, { memberId: 'madhav', amountPaise: 30000 }],
    },
    {
      id: 'e2', date: '2026-10-01', categoryName: 'Food', description: null, at: at(2),
      paidBy: 'vinod', totalPaise: 20000,
      splits: [{ memberId: 'vinod', amountPaise: 10000 }, { memberId: 'lee', amountPaise: 10000 }],
    },
    {
      id: 'e3', date: '2026-10-01', categoryName: 'Food', description: null, at: at(3),
      paidBy: 'mani', totalPaise: 24000,
      splits: [{ memberId: 'mani', amountPaise: 12000 }, { memberId: 'lee', amountPaise: 12000 }],
    },
  ];
  // Lee +30000 -10000 -12000 = +8000; Madhav -30000; Vinod +10000; Mani +12000.
  const settled: SettlementLike[] = [
    { id: 's1', date: '2026-10-10', at: at(5), fromMember: 'madhav', toMember: 'lee', amountPaise: 8000 },
    { id: 's2', date: '2026-10-10', at: at(5), fromMember: 'madhav', toMember: 'vinod', amountPaise: 10000 },
    { id: 's3', date: '2026-10-10', at: at(6), fromMember: 'madhav', toMember: 'mani', amountPaise: 12000 },
  ];

  const allTime = pairwiseNets('lee', expenses, settled);
  check(
    'all-time, the settled household still shows Lee owing Vinod',
    allTime.some((p) => p.memberId === 'vinod' && p.netPaise === -10000),
    JSON.stringify(allTime.map((p) => [p.memberId, p.netPaise]))
  );

  eq('the last zero is after the final payment', lastSquaredAt(expenses, settled), at(6));
  eq('half a settle-up is not square', lastSquaredAt(expenses, settled.slice(0, 2)), null);

  const recent = sinceLastSquare(expenses, settled);
  eq('right after settling there is nothing between anybody', pairwiseNets('lee', recent.expenses, recent.settlements).length, 0);

  // Then Vinod adds two splits and Lee adds one, as in the report.
  const later: ExpenseLike[] = [
    ...expenses,
    {
      id: 'e4', date: '2026-10-10', categoryName: 'Milk', description: null, at: at(8),
      paidBy: 'vinod', totalPaise: 6000,
      splits: ['vinod', 'lee', 'mani'].map((m) => ({ memberId: m, amountPaise: 2000 })),
    },
    {
      // Backdated: spent before the settle-up, recorded after. Still new.
      id: 'e5', date: '2026-10-05', categoryName: 'Gas', description: null, at: at(9),
      paidBy: 'vinod', totalPaise: 3000,
      splits: ['vinod', 'lee', 'mani'].map((m) => ({ memberId: m, amountPaise: 1000 })),
    },
    {
      id: 'e6', date: '2026-10-10', categoryName: 'Snacks', description: null, at: at(10),
      paidBy: 'lee', totalPaise: 900,
      splits: ['lee', 'madhav', 'mani'].map((m) => ({ memberId: m, amountPaise: 300 })),
    },
  ];
  const after = sinceLastSquare(later, settled);
  const nets = pairwiseNets('lee', after.expenses, after.settlements);
  const net = (id: string) => nets.find((p) => p.memberId === id)?.netPaise ?? 0;
  eq('Lee owes Vinod only for his two new splits', net('vinod'), -3000);
  eq('Mani owes Lee for the snacks, not the old routing', net('mani'), 300);
  eq('Madhav owes Lee for the snacks', net('madhav'), 300);
  noThrow('and it still sums to the balance', () => assertPairwiseReconciles(nets, -3000 + 600));
}

// Rows without timestamps (older callers, these tests) keep the all-time view.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'X', description: null,
      paidBy: 'me', totalPaise: 100, splits: [{ memberId: 'me', amountPaise: 100 }],
    },
  ];
  eq('no timestamps, no cutoff', lastSquaredAt(expenses, []), null);
}

// Starting from the last zero must never break the reconciliation, whatever
// the ledger -- including squares that happen mid-history and are then left.
{
  let fail = '';
  for (let i = 0; i < 2000 && !fail; i++) {
    const n = 2 + Math.floor(Math.random() * 3);
    const ids = Array.from({ length: n }, (_, j) => 'm' + j);
    const expenses: ExpenseLike[] = [];
    const settlements: SettlementLike[] = [];
    const bal = new Map(ids.map((id) => [id, 0]));
    let clock = 0;
    const stamp = () => new Date(Date.UTC(2026, 9, 1) + (clock += 1 + Math.floor(Math.random() * 2)) * 1000).toISOString();

    for (let step = 0; step < 12; step++) {
      if (Math.random() < 0.25) {
        // Settle everybody up with the plan, all at one moment or spread out.
        const plan = simplifyDebts(ids.map((id) => ({ memberId: id, balancePaise: bal.get(id)! })));
        const t = stamp();
        for (const tr of plan) {
          settlements.push({
            id: 't' + settlements.length, date: '2026-10-01', at: Math.random() < 0.5 ? t : stamp(),
            fromMember: tr.from, toMember: tr.to, amountPaise: tr.amountPaise,
          });
          bal.set(tr.from, bal.get(tr.from)! + tr.amountPaise);
          bal.set(tr.to, bal.get(tr.to)! - tr.amountPaise);
        }
        continue;
      }
      const present = ids.filter(() => Math.random() > 0.3);
      if (present.length === 0) present.push(ids[0]);
      const payer = ids[Math.floor(Math.random() * n)];
      const share = 1 + Math.floor(Math.random() * 5000);
      expenses.push({
        id: 'e' + step, date: '2026-10-01', categoryName: 'X', description: null, at: stamp(),
        paidBy: payer, totalPaise: share * present.length,
        splits: present.map((id) => ({ memberId: id, amountPaise: share })),
      });
      bal.set(payer, bal.get(payer)! + share * present.length);
      for (const id of present) bal.set(id, bal.get(id)! - share);
    }

    const recent = sinceLastSquare(expenses, settlements);
    for (const me of ids) {
      try {
        const nets = pairwiseNets(me, recent.expenses, recent.settlements);
        assertPairwiseReconciles(nets, bal.get(me)!);
        for (const pair of nets) assertLinesExplainNet(pair);
      } catch (err) {
        fail = (err as Error).message;
        break;
      }
    }
  }
  check('2000 random ledgers: counting from the last square still sums to the balance', fail === '', fail);
}

// A ledger that does not reconcile must be caught, not shrugged at.
throws('a mismatched balance is rejected', () =>
  assertPairwiseReconciles([{ memberId: 'a', netPaise: 100, lines: [] }], 999)
);

// The statement CSV exists to prove a number. If its running total does not
// land on that number the file is worse than useless -- it is evidence for the
// wrong figure.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-02', categoryName: 'Groceries', description: 'Milk, 2L',
      paidBy: 'me', totalPaise: 20000,
      splits: [{ memberId: 'me', amountPaise: 10000 }, { memberId: 'vinod', amountPaise: 10000 }],
    },
    {
      id: 'e2', date: '2026-09-01', categoryName: 'Gas', description: null,
      paidBy: 'me', totalPaise: 20000,
      splits: [{ memberId: 'me', amountPaise: 10000 }, { memberId: 'vinod', amountPaise: 10000 }],
    },
  ];
  const pair = pairwiseNets('me', expenses, [])[0];
  const rows = pairStatementRows(pair, 'Mani', 'Vinod', csvAmount);

  eq('a row per line plus a total', rows.length, 3);
  eq('oldest first', rows[0][0], '2026-09-01');
  // The user's example: Rs 200 is not one transaction, it is 100 + 100.
  eq('the running total lands on the net', rows[1][9], '200.00');
  eq('and the total row states it', rows[2][9], '200.00');
  eq('naming who owes whom', rows[2][3], 'Vinod owes Mani');
  eq('header width matches the rows', PAIR_STATEMENT_HEADERS.length, rows[0].length);

  // A description typed by a housemate goes through the same encoder as
  // everything else -- comma quoted, and a leading = neutralised.
  const csv = toCsv(PAIR_STATEMENT_HEADERS, rows);
  check('a comma in a description is quoted', csv.includes('"Milk, 2L"'), csv.split('\r\n')[2]);
}

// The pair screen shows three figures above the net. They have to subtract to
// it, or the screen is showing working that does not work.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Groceries', description: null,
      paidBy: 'me', totalPaise: 20000,
      splits: [{ memberId: 'me', amountPaise: 10000 }, { memberId: 'vinod', amountPaise: 10000 }],
    },
    {
      id: 'e2', date: '2026-09-02', categoryName: 'Rent', description: null,
      paidBy: 'vinod', totalPaise: 60000,
      splits: [{ memberId: 'me', amountPaise: 30000 }, { memberId: 'vinod', amountPaise: 30000 }],
    },
  ];
  // Money moved BOTH ways — the case an unsigned settlement total gets wrong.
  const paid: SettlementLike[] = [
    { id: 's1', date: '2026-09-03', fromMember: 'me', toMember: 'vinod', amountPaise: 5000 },
    { id: 's2', date: '2026-09-04', fromMember: 'vinod', toMember: 'me', amountPaise: 2000 },
  ];

  const pair = pairwiseNets('me', expenses, paid)[0];
  const sum = pairSummary(pair);

  eq('counts expenses and payments apart', [sum.expenseCount, sum.settlementCount], [2, 2]);
  eq('what I covered for them', sum.iCoveredPaise, 10000);
  eq('what they covered for me', sum.theyCoveredPaise, 30000);
  // 5000 out, 2000 back: the net is +3000 toward them owing me, not 7000.
  eq('settlements net, they do not accumulate', sum.settledNetPaise, 3000);
  noThrow('the three figures subtract to the net', () =>
    assertSummaryExplainsNet(sum, pair.netPaise)
  );

  throws('a summary that does not explain the net is rejected', () =>
    assertSummaryExplainsNet(sum, pair.netPaise + 1)
  );
}

// ------------- routing: a plan payment bigger than the pair debt -------------
suite('pairwise / how much of a payment was only passing through');

eq('a payer who owed nothing routes all of it', splitPayment(0, 159075), {
  directPaise: 0,
  routedPaise: 159075,
});
eq('a payer who owed more than they paid routes none', splitPayment(500000, 159075), {
  directPaise: 159075,
  routedPaise: 0,
});
eq('a negative debt is not a credit to spend', splitPayment(-5000, 10000), {
  directPaise: 0,
  routedPaise: 10000,
});

// THE REAL CASE, in paise, from the household this was reported in.
//
// Madhav owed Mani Rs 1,182.33 across shared expenses. The Fewest payments tab
// asked him for Rs 1,590.75 -- his whole household balance -- because Rs 408.42
// of it was his debt to Lee and Vinod, routed through Mani. Mani's Settle up
// then read "You owe Madhav Rs 408.42" with nothing to say why.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-06', categoryName: 'Groceries', description: 'Paneer',
      paidBy: 'madhav', totalPaise: 12500,
      splits: [{ memberId: 'mani', amountPaise: 4167 }, { memberId: 'madhav', amountPaise: 8333 }],
    },
    {
      id: 'e2', date: '2026-09-09', categoryName: 'Groceries', description: 'Curd',
      paidBy: 'mani', totalPaise: 3800,
      splits: [{ memberId: 'mani', amountPaise: 2850 }, { memberId: 'madhav', amountPaise: 950 }],
    },
    // The bulk of it, so the pair nets to exactly Rs 1,182.33 in Mani's favour.
    {
      id: 'e3', date: '2026-09-02', categoryName: 'Rent', description: 'Rent',
      paidBy: 'mani', totalPaise: 241450,
      splits: [
        { memberId: 'mani', amountPaise: 120000 },
        { memberId: 'madhav', amountPaise: 121450 },
      ],
    },
  ];

  const beforePaying = pairwiseNets('mani', expenses, [])[0];
  eq('Madhav owed Mani Rs 1,182.33 from expenses', beforePaying.netPaise, 118233);

  const paid: SettlementLike[] = [
    { id: 's1', date: '2026-09-10', fromMember: 'madhav', toMember: 'mani', amountPaise: 159075 },
  ];

  const pair = pairwiseNets('mani', expenses, paid)[0];
  eq('and afterwards Mani owes Madhav Rs 408.42', pair.netPaise, -40842);

  const payment = pair.lines.find((l) => l.kind === 'settlement')!;
  eq('the payment settled Rs 1,182.33 of real debt', payment.directPaise, 118233);
  eq('and routed Rs 408.42 through Mani', payment.routedPaise, 40842);

  eq('the pair total agrees', pairRouting(pair), { receivedPaise: 40842, sentPaise: 0 });

  noThrow('the split adds up to what was paid', () => assertRoutingSplitsPayments(pair));

  // The residue Mani is looking at IS the routed amount, with no expenses
  // between them since. That is the sentence the Settle up card now says.
  eq('the residue is exactly what was routed', -pair.netPaise, payment.routedPaise);

  // Madhav's side of the same ledger: he is square with the house, yet
  // pairwise Mani owes him. Both are true, which is why it needed explaining.
  const his = pairwiseNets('madhav', expenses, paid)[0];
  eq('the same payment, seen from the payer', [his.netPaise, his.lines[0].routedPaise], [40842, 40842]);
}

// A payment that is NOT routed must say so, or the explanation becomes noise
// on every ordinary settle-up.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Groceries', description: null,
      paidBy: 'me', totalPaise: 10000,
      splits: [{ memberId: 'me', amountPaise: 5000 }, { memberId: 'vinod', amountPaise: 5000 }],
    },
  ];
  const paid: SettlementLike[] = [
    { id: 's1', date: '2026-09-03', fromMember: 'vinod', toMember: 'me', amountPaise: 5000 },
  ];
  const pair = pairwiseNets('me', expenses, paid)[0];
  eq('an exact pairwise payment routes nothing', pair.lines[0].routedPaise, 0);
  eq('nothing passed through', pairRouting(pair), { receivedPaise: 0, sentPaise: 0 });
}

// Two payments, and an expense between them: the replay has to re-read the
// debt each time rather than compare against the final net.
{
  const expenses: ExpenseLike[] = [
    {
      id: 'e1', date: '2026-09-01', categoryName: 'Rent', description: null,
      paidBy: 'me', totalPaise: 20000,
      splits: [{ memberId: 'me', amountPaise: 10000 }, { memberId: 'vinod', amountPaise: 10000 }],
    },
    {
      id: 'e2', date: '2026-09-05', categoryName: 'Rent', description: null,
      paidBy: 'me', totalPaise: 8000,
      splits: [{ memberId: 'me', amountPaise: 4000 }, { memberId: 'vinod', amountPaise: 4000 }],
    },
  ];
  const paid: SettlementLike[] = [
    // Clears the 10000, then 2000 more that was somebody else's.
    { id: 's1', date: '2026-09-03', fromMember: 'vinod', toMember: 'me', amountPaise: 12000 },
    // By now Vinod owes 4000 again (e2) less the 2000 he is ahead: 2000.
    { id: 's2', date: '2026-09-07', fromMember: 'vinod', toMember: 'me', amountPaise: 3000 },
  ];

  const pair = pairwiseNets('me', expenses, paid)[0];
  const first = pair.lines.find((l) => l.id === 's1')!;
  const second = pair.lines.find((l) => l.id === 's2')!;

  eq('the first payment routes the excess', [first.directPaise, first.routedPaise], [10000, 2000]);
  eq('the second reads the debt as it stood', [second.directPaise, second.routedPaise], [2000, 1000]);
  eq('routed totals accumulate', pairRouting(pair).receivedPaise, 3000);
  noThrow('both splits add up', () => assertRoutingSplitsPayments(pair));
}

// The split must survive the same random ledgers the net invariant runs on --
// a routed figure that does not sum to the payment is a number on screen that
// no bank statement agrees with.
{
  let fail = '';
  for (let i = 0; i < 2000 && !fail; i++) {
    const people = ['me', 'a', 'b', 'c'];
    const expenses: ExpenseLike[] = [];
    const settlements: SettlementLike[] = [];

    for (let e = 0; e < 6; e++) {
      const payer = people[Math.floor(Math.random() * people.length)];
      const inIt = people.filter(() => Math.random() > 0.3);
      if (!inIt.includes(payer)) inIt.push(payer);
      const each = 1000 + Math.floor(Math.random() * 5000);
      expenses.push({
        id: `e${e}`,
        date: `2026-09-${String(1 + Math.floor(Math.random() * 20)).padStart(2, '0')}`,
        categoryName: 'X', description: null, paidBy: payer,
        totalPaise: each * inIt.length,
        splits: inIt.map((m) => ({ memberId: m, amountPaise: each })),
      });
    }

    for (let s = 0; s < 3; s++) {
      const from = people[Math.floor(Math.random() * people.length)];
      const to = people.filter((p) => p !== from)[Math.floor(Math.random() * 3)];
      settlements.push({
        id: `s${s}`,
        date: `2026-09-${String(1 + Math.floor(Math.random() * 20)).padStart(2, '0')}`,
        fromMember: from, toMember: to,
        amountPaise: 1000 + Math.floor(Math.random() * 20000),
      });
    }

    for (const pair of pairwiseNets('me', expenses, settlements)) {
      try {
        assertRoutingSplitsPayments(pair);
        assertLinesExplainNet(pair);
      } catch (err) {
        fail = (err as Error).message;
        break;
      }
    }
  }
  check('2000 random ledgers: every payment splits into two real halves', fail === '', fail);
}

throws('a doctored split is rejected', () => {
  const pair = pairwiseNets(
    'me',
    [],
    [{ id: 's1', date: '2026-09-01', fromMember: 'vinod', toMember: 'me', amountPaise: 5000 }]
  )[0];
  pair.lines[0].routedPaise = 1;
  assertRoutingSplitsPayments(pair);
});

process.exit(report() > 0 ? 1 : 0);
