/**
 * Security tests: what can a stranger with the publishable key see or do?
 *
 * The key ships inside the APK, so anyone with the file has it. Row level
 * security is the only thing protecting the ledger, and these tests exercise
 * it from the outside with no session at all.
 *
 * Run: node tests/security.test.mjs
 */
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const URL_BASE = /EXPO_PUBLIC_SUPABASE_URL=(.+)/.exec(env)[1].trim();
const KEY = /EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim();
const REST = `${URL_BASE}/rest/v1`;
const H = { apikey: KEY, 'Content-Type': 'application/json' };

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

async function get(path) {
  const r = await fetch(`${REST}/${path}`, { headers: H });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

async function post(path, payload) {
  const r = await fetch(`${REST}/${path}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.text() };
}

// Anonymous reads must return nothing, not an error and not data. RLS filters
// rather than rejects, so an empty array is the correct pass.
const TABLES = [
  'households',
  'members',
  'expenses',
  'expense_splits',
  'settlements',
  'categories',
  'away_periods',
  'periods',
  'invites',
  'join_requests',
  'pending_changes',
  'audit_log',
  'notifications',
  'notification_reads',
  'push_tokens',
  'recurring_expenses',
  'recurring_postings',
  // 0035: which number belongs to which account, and the lockout counter.
  'phone_logins',
  'phone_login_attempts',
];

for (const t of TABLES) {
  const res = await get(`${t}?select=*&limit=5`);
  const leaked = Array.isArray(res.body) && res.body.length > 0;
  check(
    `anon cannot read ${t}`,
    !leaked,
    leaked ? `LEAKED ${res.body.length} rows` : ''
  );
}

// Derived views must be just as closed as the tables behind them.
for (const v of ['member_balances', 'member_ledger', 'monthly_category_totals']) {
  const res = await get(`${v}?select=*&limit=5`);
  const leaked = Array.isArray(res.body) && res.body.length > 0;
  check(`anon cannot read view ${v}`, !leaked, leaked ? `LEAKED ${res.body.length} rows` : '');
}

// Writes must be refused outright.
const w1 = await post('expenses', {
  household_id: '00000000-0000-0000-0000-000000000000',
  paid_by: '00000000-0000-0000-0000-000000000000',
  total_paise: 1,
  category_id: '00000000-0000-0000-0000-000000000000',
  expense_date: '2026-01-01',
  created_by: '00000000-0000-0000-0000-000000000000',
});
check('anon cannot insert an expense', w1.status >= 400, `status ${w1.status}`);

const w2 = await post('members', {
  household_id: '00000000-0000-0000-0000-000000000000',
  display_name: 'intruder',
  joined_on: '2026-01-01',
});
check('anon cannot insert a member', w2.status >= 400, `status ${w2.status}`);

const w3 = await post('notification_reads', {
  notification_id: '00000000-0000-0000-0000-000000000000',
  member_id: '00000000-0000-0000-0000-000000000000',
});
check('anon cannot mark notifications read', w3.status >= 400, `status ${w3.status}`);

// Privileged operations must refuse an anonymous caller.
const RPCS = [
  ['create_household', { p_name: 'x', p_display_name: 'y' }],
  ['add_placeholder_member', { p_name: 'intruder' }],
  ['create_invite', { p_max_uses: 1, p_valid_days: 7 }],
  ['close_period', { p_period: '00000000-0000-0000-0000-000000000000' }],
  ['mark_notifications_read', {}],
  ['register_push_token', { p_token: 'ExponentPushToken[fake]' }],
  // Both added in 0017. They are SECURITY DEFINER, so they run with the
  // definer's rights and RLS cannot save us -- their own is_owner() and
  // current_member() guards are the only thing standing in the way.
  ['remove_member', { p_member_id: '00000000-0000-0000-0000-000000000000' }],
  ['update_my_profile', { p_display_name: 'intruder', p_avatar_color: '#4F7DF0' }],
  [
    'create_expense',
    {
      p_total_paise: 1,
      p_category: '00000000-0000-0000-0000-000000000000',
      p_expense_date: '2026-01-01',
      p_paid_by: '00000000-0000-0000-0000-000000000000',
      p_splits: [],
    },
  ],
  // The write that moves money, so the one most worth asserting. It is back to
  // SECURITY INVOKER as of 0033 -- 0032 made it definer to escape a 42501 whose
  // real cause was a missing period trigger -- so RLS backs up these guards
  // again. Asserted anyway: an anon caller must not get past the first one.
  [
    'record_settlement',
    {
      p_from: '00000000-0000-0000-0000-000000000000',
      p_to: '00000000-0000-0000-0000-000000000001',
      p_amount: 1,
      p_date: '2026-01-01',
      p_note: null,
    },
  ],
];

for (const [fn, args] of RPCS) {
  const res = await post(`rpc/${fn}`, args);
  // Either refused outright, or it ran as a member-less caller and did
  // nothing. Anything that reports success with real work done is a failure.
  const refused = res.status >= 400;
  // 204 No Content is what a void function returns after an early exit, so
  // it counts as inert too.
  const inert =
    res.status === 204 ||
    (res.status === 200 && /^(null|0|""|\[\]|)$/.test(res.body.trim()));
  check(`anon cannot usefully call ${fn}`, refused || inert, `status ${res.status} body ${res.body.slice(0, 80)}`);
}

// The cross-household canary must not be callable by a client at all. Unlike
// the RPCs above it is not merely inert for a stranger -- it reports on EVERY
// household -- so 0018 revokes EXECUTE rather than relying on a guard inside.
const canary = await post('rpc/ledger_imbalance', {});
check(
  'anon cannot call ledger_imbalance at all',
  canary.status >= 400,
  `status ${canary.status} body ${canary.body.slice(0, 80)}`
);

// Internal helpers a client must not be able to reach at all. Before 0034 all
// three were open: functions created after 0004's one-time revoke kept the
// default EXECUTE-to-PUBLIC grant. notify_household had no caller check, so a
// stranger could push arbitrary text to every phone in a household.
const INTERNAL = [
  [
    'notify_household',
    {
      p_household: '00000000-0000-0000-0000-000000000000',
      p_kind: 'expense_added',
      p_entity: null,
      p_amount: null,
      p_subject: 'intruder',
    },
  ],
  ['send_push_for_notification', { p_notification: '00000000-0000-0000-0000-000000000000' }],
  ['ensure_period', { p_household: '00000000-0000-0000-0000-000000000000', p_date: '2026-01-01' }],
];
for (const [fn, args] of INTERNAL) {
  const res = await post(`rpc/${fn}`, args);
  // Must be refused for lack of EXECUTE (42501). Any other error means the
  // function body ran and only tripped over the fake ids -- a 23503 foreign key
  // failure here is the hole, not a pass.
  const denied = res.status === 401 || res.status === 403 || /"42501"/.test(res.body);
  check(`anon cannot call ${fn} at all`, denied, `status ${res.status} body ${res.body.slice(0, 80)}`);
}

// Phone sign-in (0035) is the one thing anon may call. It must hand back an
// email only for the right password, so it cannot be used to collect them.
// A malformed number returns early without counting as an attempt, so this
// check never locks anyone out.
const phoneProbe = await post('rpc/phone_sign_in_email', { p_phone: 'not-a-phone', p_password: 'x' });
check(
  'phone sign-in returns nothing without a valid number and password',
  phoneProbe.status === 200 && phoneProbe.body.trim() === 'null',
  `status ${phoneProbe.status} body ${phoneProbe.body.slice(0, 80)}`
);

// An invite code must not expose the ledger to someone who has not joined.
const preview = await post('rpc/preview_invite', { p_code: 'AAA-AAA' });
check(
  'preview_invite rejects an unknown code',
  preview.status >= 400,
  `status ${preview.status} body ${preview.body.slice(0, 80)}`
);

let failed = 0;
console.log('## security (unauthenticated)');
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) {
  console.log('\nFAILING:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.name} -- ${r.detail}`);
}
process.exit(failed > 0 ? 1 : 0);
