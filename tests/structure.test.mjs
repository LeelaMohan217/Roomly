/**
 * Structural tests: things that compile but are still wrong.
 *
 * Typescript will not tell you that a Stack.Screen names a file that does not
 * exist, that a route file was never registered, or that two migrations share
 * a number. These are the mistakes that show up as a blank screen.
 *
 * Run: node tests/structure.test.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'src', 'app');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(APP).filter((f) => f.endsWith('.tsx'));
const routeFiles = files.filter((f) => !f.endsWith('_layout.tsx'));

/** src/app/(app)/(tabs)/history.tsx -> /history ; .../index.tsx -> / */
function toRoute(file) {
  let p = relative(APP, file).split(sep).join('/').replace(/\.tsx$/, '');
  p = p
    .split('/')
    .filter((seg) => !/^\(.*\)$/.test(seg))
    .join('/');
  if (p.endsWith('index')) p = p.slice(0, -'index'.length);
  p = '/' + p;
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

const routes = new Set(routeFiles.map(toRoute));

// ---- every navigation target must exist -----------------------------------
const src = walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f));
const targets = new Map();

for (const f of src) {
  const text = readFileSync(f, 'utf8');
  const patterns = [
    /push\(\s*'(\/[a-z0-9\-/[\]]*)'/gi,
    /replace\(\s*'(\/[a-z0-9\-/[\]]*)'/gi,
    /pathname:\s*'(\/[a-z0-9\-/[\]]*)'/gi,
    /href:\s*'(\/[a-z0-9\-/[\]]*)'/gi,
    /href="(\/[a-z0-9\-/[\]]*)"/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      if (!targets.has(m[1])) targets.set(m[1], relative(ROOT, f));
    }
  }
}

for (const [target, from] of targets) {
  check(`route target ${target} exists`, routes.has(target), `linked from ${from}`);
}

// ---- every Stack.Screen must name a real file ------------------------------
const layouts = files.filter((f) => f.endsWith('_layout.tsx'));
for (const layout of layouts) {
  const dir = layout.slice(0, -'/_layout.tsx'.length).replace(/[\\/]_layout\.tsx$/, '');
  const text = readFileSync(layout, 'utf8');
  const re = /<(?:Stack|Tabs)\.Screen\s+name="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const base = join(layout, '..', name);
    const exists =
      files.includes(base + '.tsx') ||
      files.includes(join(base, '_layout.tsx')) ||
      files.some((f) => f.startsWith(join(layout, '..', name.split('/')[0])));
    check(
      `${relative(ROOT, layout)} declares "${name}" which exists`,
      exists,
      exists ? '' : 'no matching file'
    );
  }
}

// ---- every route file should be registered somewhere -----------------------
const declared = new Set();
for (const layout of layouts) {
  const text = readFileSync(layout, 'utf8');
  const re = /<(?:Stack|Tabs)\.Screen\s+name="([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) declared.add(m[1]);
}
for (const f of routeFiles) {
  const rel = relative(APP, f).split(sep).join('/').replace(/\.tsx$/, '');
  const segs = rel.split('/');
  const own = segs[segs.length - 1] === 'index' ? segs.slice(-2).join('/') : segs[segs.length - 1];
  const name = segs[segs.length - 1] === 'index' ? 'index' : own;
  const nested = segs.length >= 2 ? segs.slice(-2).join('/') : name;
  const known =
    declared.has(name) ||
    declared.has(nested) ||
    [...declared].some((d) => d.split('/')[0] === segs[segs.length - 2]);
  check(`route file ${rel} is registered in a layout`, known, known ? '' : 'never declared');
}

// ---- migrations must be sequential and unique ------------------------------
const migDir = join(ROOT, 'supabase', 'migrations');
const migs = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const nums = migs.map((f) => parseInt(f.slice(0, 4), 10));
check('migration numbers are unique', new Set(nums).size === nums.length, nums.join(','));
check(
  'migration numbers have no gaps',
  nums.every((n, i) => i === 0 || n === nums[i - 1] + 1),
  nums.join(',')
);

// ---- migrations must stay ASCII -------------------------------------------
for (const f of migs) {
  const text = readFileSync(join(migDir, f), 'utf8');
  const bad = [...text].filter((c) => c.charCodeAt(0) > 127).length;
  // 0004 predates the ASCII rule and still holds the corrupted emoji seed.
  check(`${f} is pure ASCII`, bad === 0, bad ? `${bad} non-ASCII characters` : '');
}

// ---- no secrets committed --------------------------------------------------
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
check(
  '.env.example holds no real key',
  !/sb_publishable_[A-Za-z0-9]{10,}/.test(envExample) || envExample.includes('your-key-here'),
  'a real-looking key is in .env.example'
);
const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
check('.env is gitignored', /^\.env$/m.test(gitignore) || /^\.env\*/m.test(gitignore));

// -- OTA identity -----------------------------------------------------------
// updateId is non-null for the bundle embedded in the APK, so testing it for
// truthiness reports "running an OTA update" on a fresh install that has never
// contacted the update server. isEmbeddedLaunch is the only correct test, and
// this shipped wrong once already.
const buildInfo = readFileSync(join(ROOT, 'src/lib/build-info.ts'), 'utf8');
check(
  'embedded launch detected with isEmbeddedLaunch',
  buildInfo.includes('Updates.isEmbeddedLaunch'),
  'build-info.ts does not use isEmbeddedLaunch'
);
check(
  'updateState does not infer OTA from updateId',
  !/return Updates.updateId ? 'updated'/.test(buildInfo),
  'updateState is back to testing updateId, which is always set'
);

// A single catch-all failure message blamed the network for a missing
// publish. Keep the two apart.
check(
  'update check separates offline from nothing-published',
  buildInfo.includes("kind: 'offline'") && buildInfo.includes("kind: 'nothing-published'"),
  'checkForUpdate collapses distinct failures into one'
);
const settingsSrc = readFileSync(join(ROOT, 'src/app/(app)/settings.tsx'), 'utf8');
check(
  'settings does not blame signal for every failure',
  !settingsSrc.includes('Try again when you have signal'),
  'the misleading catch-all message is still shown'
);

// -- Realtime subscription safety -------------------------------------------
// supabase-js dedupes channels by topic and THROWS from .on() if the channel it
// hands back has already joined, and removeChannel() is async so the old one is
// still registered on the next effect run. A fixed topic therefore crashed the
// tab tree. Both halves of the fix are load-bearing.
const realtime = readFileSync(join(ROOT, 'src/lib/realtime.ts'), 'utf8');
check(
  'realtime topic is unique per subscription',
  /channel-`|household-${householdId}-${/.test(realtime) || realtime.includes('subscriptionSeq'),
  'realtime.ts reuses a fixed channel topic, which throws on re-subscribe'
);
check(
  'realtime effect depends on the id, not the member object',
  /[householdId, queryClient]/.test(realtime),
  'the effect still depends on the member object and will churn'
);
check(
  'a realtime failure cannot unwind the tree',
  realtime.includes('try {') && realtime.includes('} catch') && realtime.includes('.subscribe()'),
  'subscribe() is not guarded, so a throw propagates out of useEffect'
);

// The diagnostic route added while chasing the calendar shape must not ship:
// it sits outside every auth guard.
check(
  'no leftover dev-only routes',
  !existsSync(join(ROOT, 'src/app/dev-calendar.tsx')),
  'src/app/dev-calendar.tsx is still present'
);

// -- Calendar day shape -----------------------------------------------------
// A circle built from a percentage width + aspectRatio + borderRadius:999
// depends on Yoga and web CSS agreeing on all three. They did not.
const cal = readFileSync(join(ROOT, 'src/components/ui/month-calendar.tsx'), 'utf8');
check(
  'day circle is sized in explicit pixels',
  cal.includes('borderRadius: diameter / 2'),
  'the day circle no longer derives its radius from its measured diameter'
);
check(
  'day circle does not rely on percentage + aspectRatio',
  !/dayInner: {[^}]*width: '76%'/.test(cal),
  'dayInner is back to a percentage width'
);

// ---- ledger invariants that no other suite can reach -----------------------
//
// The SQL layer has no automated coverage at all, and every P0/P1 bug found in
// the Stage 1 audit was the same shape: a rule changed in one migration and its
// duplicate copy elsewhere was not updated. These assert the shape of the
// LATEST definition of each function, so a future migration that regresses one
// of them fails here rather than in production six weeks later.

/** The last migration that defines `name`, as text. */
function latestDefinitionOf(name) {
  for (const f of [...migs].reverse()) {
    const text = readFileSync(join(migDir, f), 'utf8');
    // The whole `create or replace function` phrase, not a bare `function x(`:
    // that also matches a `drop function` line, a `grant execute on function`
    // line, and -- the one that actually bit -- a Postgres CONTEXT line quoted
    // in a migration's header comment. Matching prose made the slice below run
    // from the comment to the real definition and return the comment.
    const at = text.indexOf(`create or replace function ${name}(`);
    if (at === -1) continue;
    // Function bodies here are all $tag$ ... $tag$; take to the next
    // `create or replace` or end of file, which is close enough to isolate one.
    const rest = text.slice(at);
    const next = rest.indexOf('\ncreate or replace function', 1);
    return { file: f, body: next === -1 ? rest : rest.slice(0, next) };
  }
  return null;
}

const balanceFn = latestDefinitionOf('member_balance');
check(
  'there is a single definition of a balance',
  !!balanceFn,
  'member_balance() is gone -- the arithmetic has been inlined again'
);
check(
  'the balance counts confirmed settlements only',
  !!balanceFn && /confirmed_at is not null/.test(balanceFn.body),
  'member_balance() would count money nobody has confirmed receiving'
);

const removeFn = latestDefinitionOf('remove_member');
check(
  'remove_member asks for the balance rather than restating it',
  !!removeFn && /member_balance\(/.test(removeFn.body),
  'remove_member has its own copy of the arithmetic again -- this is bug P1-1'
);

// The race that produced two rents: the posting row must be claimed BEFORE the
// expense is written, so the loser of the unique-index race writes nothing.
const postFn = latestDefinitionOf('post_recurring_now');
const claimAt = postFn ? postFn.body.indexOf('insert into recurring_postings') : -1;
const spendAt = postFn ? postFn.body.indexOf('insert into expenses') : -1;
check(
  'recurring claims the month before writing the expense',
  claimAt > -1 && spendAt > -1 && claimAt < spendAt,
  'the expense is written before the posting row is claimed -- this is bug P0-2'
);
check(
  'recurring refuses to post a paused rule',
  !!postFn && /is_active/.test(postFn.body),
  'post_recurring_now no longer checks is_active'
);
check(
  'recurring falls back rather than raising when everyone is away',
  !!postFn && /v_participants := v_residents/.test(postFn.body),
  'the SQL raises where split.ts falls back, so one rule can kill the batch'
);

// Backfill: a month nobody opened the app in must still post later.
const dueFn = latestDefinitionOf('post_due_recurrences');
check(
  'recurring backfills months that were missed',
  !!dueFn && /while /.test(dueFn.body),
  'post_due_recurrences looks only at the current month -- this is bug P0-3'
);

// Closed months: three functions bypass RLS and so must check the period
// themselves.
for (const fn of ['review_pending_change', 'review_settlement', 'post_recurring_now']) {
  const def = latestDefinitionOf(fn);
  check(
    `${fn} checks the month is open`,
    !!def && /period_is_open/.test(def.body),
    `${fn} is SECURITY DEFINER and can rewrite a closed month`
  );
}

// Idempotency: the key has to be accepted AND sent. It was generated and never
// sent for the whole life of the outbox.
const createFn = latestDefinitionOf('create_expense');
check(
  'create_expense accepts an idempotency key',
  !!createFn && /p_client_id/.test(createFn.body),
  'a replayed offline write would create a second expense'
);
const syncSrc = readFileSync(join(ROOT, 'src', 'lib', 'sync.tsx'), 'utf8');
check(
  'both send paths pass the idempotency key',
  (syncSrc.match(/p_client_id/g) ?? []).length >= 2,
  'the drain or the online path still posts without a client id'
);

// A closed month needs a way back out now that the lock actually holds.
const appSrc = walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f));
check(
  'reopen_period has a caller',
  appSrc.some((f) => /reopen_period/.test(readFileSync(f, 'utf8'))),
  'the app tells people to reopen a month but offers no way to do it'
);

// The client and the SQL split the same expense the same way.
check(
  'client and SQL hand the remainder paisa to the same person',
  !!postFn && /order by \(m\.id <> r\.paid_by\), m\.created_at/.test(postFn.body),
  'the SQL orders by uuid while split.ts orders by created_at'
);

// ---- session dead ends (Stage 2) -------------------------------------------
//
// Each of these was a state a real user could reach and not get out of. They
// are asserted on source text because there is no way to drive the session
// machine from a test runner.

const sessionSrc = readFileSync(join(ROOT, 'src', 'lib', 'session.tsx'), 'utf8');

// "You are in no household" and "we could not find out" are different answers.
// Conflating them ejected offline members to the onboarding screen, where both
// buttons need the network.
check(
  'the membership read checks its error',
  /memberError/.test(sessionSrc) && /error: memberError/.test(sessionSrc),
  'session.tsx ignores the error again and treats a failed read as "no household"'
);
check(
  'a known membership survives a failed read',
  /readCachedMembership/.test(sessionSrc) && /writeCachedMembership/.test(sessionSrc),
  'nothing caches the member row, so a cold offline start has nothing to fall back on'
);
check(
  'two pending requests do not error the read',
  /\.limit\(1\)\s*\n?\s*\.maybeSingle\(\)/.test(sessionSrc) || /limit\(1\)/.test(sessionSrc),
  'maybeSingle() on join_requests errors when a user has requests in two households'
);

// The crash realtime.ts was rewritten to prevent, reintroduced in session.tsx.
check(
  'the join-request channel topic is unique per subscription',
  /joinWatchSeq/.test(sessionSrc),
  'session.tsx reuses a fixed channel topic, and .on() throws on an already-joined channel'
);
check(
  'the join-request subscription cannot unwind the tree',
  /try\s*{[\s\S]*supabase\s*\n?\s*\.channel\(topic\)/.test(sessionSrc),
  'the subscribe call is unguarded, so a throw escapes useEffect'
);
check(
  'the join watch depends on the id, not the request object',
  /}, \[pendingId\]\);/.test(sessionSrc),
  'the effect depends on `pending`, a fresh object each load, so it churns'
);

// Realtime is a server-side setting that can be off. Without a fallback an
// approved joiner waits forever with no button that helps.
check(
  'approval is polled as well as pushed',
  /WAITING_POLL_MS/.test(sessionSrc) && /setInterval/.test(sessionSrc),
  'the waiting screen advances only over Realtime'
);
const waitingSrc = readFileSync(join(ROOT, 'src', 'app', 'waiting.tsx'), 'utf8');
check(
  'the waiting screen offers a manual re-check',
  /Check now/.test(waitingSrc),
  'there is no way to nudge it if the subscription is dead'
);
check(
  'cancelling a request surfaces its failure',
  /updateError/.test(waitingSrc),
  'waiting.tsx discards the update result, so Cancel silently does nothing'
);

// A splash screen with no timeout is indistinguishable from a crash.
check(
  'boot cannot hang forever',
  /withTimeout\(loadMembership/.test(sessionSrc),
  'setBooting(false) still waits on an unbounded request'
);

// supabase-js holds its auth lock for the duration of onAuthStateChange and
// documents that calling client methods inside it can deadlock.
check(
  'the auth callback does not call the database inline',
  /onAuthStateChange\(\(_event, next\) => {/.test(sessionSrc),
  'the handler is async and awaits a PostgREST read while the auth lock is held'
);

// Signing out must not leave the previous account's data on the device.
check(
  'signing out clears the caches',
  /queryClient\.clear\(\)/.test(sessionSrc) && /clearOutbox\(\)/.test(sessionSrc),
  'the persisted query cache has no per-user key, so the next account sees the last one'
);

// The stuck spinners: await refresh() then never clearing busy left the button
// spinning with Back disabled, unrecoverable without killing the app.
for (const screen of ['create-household.tsx', 'join-household.tsx']) {
  const text = readFileSync(join(ROOT, 'src', 'app', screen), 'utf8');
  check(
    `${screen} always clears its busy flag`,
    /await refresh\(\);\s*\n[\s\S]{0,600}?setBusy\(false\);/.test(text),
    'busy is left true after refresh(), so the screen can spin forever'
  );
  check(
    `${screen} does not leak raw Postgres text`,
    !/setError\(rpcError\.message\)/.test(text),
    'rpcError.message is shown to the user instead of humanError()'
  );
}

// Routes that are not declared under the active guard do not exist, so
// navigating to one does nothing at all.
const resetSrc = readFileSync(join(ROOT, 'src', 'app', 'reset-password.tsx'), 'utf8');
check(
  'reset-password sends people to a route that exists',
  !/router\.replace\('\/'\)/.test(resetSrc) && !/router\.replace\('\/forgot-password'\)/.test(resetSrc),
  'a button targets a route excluded by the current guard, so it is inert'
);

// A silent queue is how people believe an expense was recorded when it was not.
const tabsLayout = readFileSync(join(ROOT, 'src', 'app', '(app)', '(tabs)', '_layout.tsx'), 'utf8');
check(
  'the sync banner is mounted for the whole tab shell',
  /SyncBanner/.test(tabsLayout),
  'the queue indicator exists on one screen only'
);

// The rejoin lockout: a global unique on user_id meant anyone ever removed
// could neither rejoin nor start a household.
const joinFn = latestDefinitionOf('request_join');
check(
  'request_join lets a departed member come back',
  !!joinFn && /left_on is null/.test(joinFn.body),
  'the "already a member" check ignores left_on, so rejoining is refused'
);
const migAll = migs.map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
check(
  'only ACTIVE memberships are unique per account',
  /members_active_user_key/.test(migAll),
  'the global unique on members.user_id locks out anyone who was ever removed'
);
check(
  'Realtime is enabled in SQL, not a dashboard checkbox',
  /alter publication supabase_realtime add table notifications/.test(migAll) &&
    /alter publication supabase_realtime add table join_requests/.test(migAll),
  'the publication is a manual step no migration records'
);

// ---- Settle up must say which way the money goes -------------------------
//
// Reported from a real pair of screenshots: the owner saw "who pays whom",
// while a member who was only ever OWED money saw the same rows under "YOUR
// PAYMENTS" with an "I have paid this" button on every one of them.
//
// The button is the serious half. Recording a settlement where you are the
// payee auto-confirms it (migration 0026), so one tap on a row that was
// actually money coming IN wrote that money off as received.

const settleSrc = readFileSync(join(ROOT, 'src', 'app', '(app)', 'settle.tsx'), 'utf8');

// Stage 5 moved the direction split from the TRANSFER list to the pairwise
// lists — `betweenOthers` is gone because the plan is one section again and
// each row derives its own kind. The property being asserted is unchanged and
// stronger: money in and money out are never shown under one heading.
check(
  'money in and money out are never one list',
  /const iOwe = pairs\.rows\.filter/.test(settleSrc) &&
    /const owedToMe = pairs\.rows\.filter/.test(settleSrc) &&
    /renderPairs\('OWED TO YOU'/.test(settleSrc) &&
    /renderPairs\('YOU OWE'/.test(settleSrc),
  'settle.tsx groups every row a member is part of under one heading again'
);
check(
  'no single heading calls incoming money "your payments"',
  !/'YOUR PAYMENTS'/.test(settleSrc),
  'the flat YOUR PAYMENTS heading is back, and it lies about money coming in'
);
check(
  'the action depends on which side you are on',
  /kind === 'owed'\s*\n?\s*\?\s*'Mark as received'/.test(settleSrc),
  'the button label keys off isOwner again, so a payee is offered "I have paid this"'
);
check(
  'recording a receipt is confirmed as a receipt',
  /Did this land\?/.test(settleSrc),
  'the confirm dialog does not distinguish money received from money sent'
);
check(
  'sections are called, not rendered as an inline component',
  /renderSection\(/.test(settleSrc) && !/<TransferSection/.test(settleSrc),
  'a component declared inside the screen remounts every card on each render'
);

// ---- daily usability (Stage 3) ---------------------------------------------

// The Android keyboard. use-keyboard-height.ts:7-15 states in writing that
// KeyboardAvoidingView is INERT on Android under SDK 57's edge-to-edge layout
// "with any behavior" — and ten forms depended on it anyway. Add Expense was
// the worst: it autofocuses the amount, so Save was behind the keyboard from
// the first frame of the app's most-used action.
const rnFiles = walk(join(ROOT, 'src')).filter((f) => /\.tsx$/.test(f));
// The replacement component is excluded by name: its own doc comment quotes
// the JSX it replaces, which is the point of the comment.
const stillAvoiding = rnFiles
  .filter((f) => !f.endsWith('keyboard-aware-scroll-view.tsx'))
  .filter((f) => /<KeyboardAvoidingView/.test(readFileSync(f, 'utf8')));
check(
  'no screen relies on KeyboardAvoidingView',
  stillAvoiding.length === 0,
  stillAvoiding.map((f) => relative(ROOT, f)).join(', ')
);
check(
  'the replacement measures the keyboard instead',
  existsSync(join(ROOT, 'src', 'components', 'ui', 'keyboard-aware-scroll-view.tsx')) &&
    /useKeyboardHeight/.test(
      readFileSync(join(ROOT, 'src', 'components', 'ui', 'keyboard-aware-scroll-view.tsx'), 'utf8')
    ),
  'the keyboard-aware scroll view is gone or no longer measures anything'
);

// You could not log an expense for any day but today or yesterday: the third
// segment was a plain View, not a Pressable, and only rendered when editing.
const formSrc = readFileSync(join(ROOT, 'src', 'components', 'expense-form.tsx'), 'utf8');
check(
  'an expense can be dated any day',
  /MonthCalendar/.test(formSrc) && /setPickingDate\(true\)/.test(formSrc),
  'expense-form has no date picker — only Today and Yesterday can be chosen'
);

// An empty state is a claim about the data, and may only be made once the data
// has been read. `grep isError src/` used to return nothing at all.
const stateHelper = join(ROOT, 'src', 'components', 'ui', 'query-state.tsx');
check(
  'there is one shared loading/failed state',
  existsSync(stateHelper),
  'query-state.tsx is gone, so each screen is hand-rolling this again'
);
for (const screen of [
  ['(tabs)', 'history.tsx'],
  ['(tabs)', 'reports.tsx'],
  ['', 'settlements.tsx'],
  ['', 'notifications.tsx'],
  ['', 'edit-history.tsx'],
  ['', 'settle.tsx'],
  ['', 'month-statement.tsx'],
]) {
  const file = join(ROOT, 'src', 'app', '(app)', screen[0], screen[1]);
  const text = readFileSync(file, 'utf8');
  check(
    `${screen[1]} tells a failed load apart from an empty one`,
    /queryState\(/.test(text),
    'it falls through to its empty state after a failed fetch'
  );
}
check(
  'the month statement does not state a total it has not loaded',
  !/\{totals\.isLoading \? 'Loading…'/.test(
    readFileSync(join(ROOT, 'src', 'app', '(app)', 'month-statement.tsx'), 'utf8')
  ) &&
    /statement\.isLoading \|\| statement\.isError/.test(
      readFileSync(join(ROOT, 'src', 'app', '(app)', 'month-statement.tsx'), 'utf8')
    ),
  'it asserts "Household spent Rs 0.00 across 0 expenses" while loading'
);

// The month statement must reconcile with every balance in the app.
check(
  'the statement counts confirmed settlements only',
  /\.not\('confirmed_at', 'is', null\)/.test(readFileSync(join(ROOT, 'src', 'lib', 'queries.ts'), 'utf8')),
  'useMonthStatement lists payments nobody has confirmed, which no balance counts'
);
check(
  'the statement keeps members who have moved out',
  /hasLeft/.test(readFileSync(join(ROOT, 'src', 'lib', 'queries.ts'), 'utf8')),
  'perMember filters left_on while expenses are unfiltered, so the columns do not add up'
);

// joined_on was unsettable, so a household set up mid-month could never enter
// the days before it existed.
const joinedFn = latestDefinitionOf('add_placeholder_member');
check(
  'a housemate can be recorded as having lived here already',
  !!joinedFn && /p_joined_on/.test(joinedFn.body),
  'add_placeholder_member still defaults joined_on to today'
);
check(
  'and the move-in date can be corrected afterwards',
  !!latestDefinitionOf('set_member_joined_on'),
  'existing households have no way to fix a joined_on that is too late'
);
check(
  'the add-housemate sheet asks for it',
  /p_joined_on/.test(readFileSync(join(ROOT, 'src', 'app', '(app)', 'household.tsx'), 'utf8')),
  'the RPC accepts a move-in date but nothing sends one'
);

// Silent failures.
const householdSrc = readFileSync(join(ROOT, 'src', 'app', '(app)', 'household.tsx'), 'utf8');
check(
  'a failed invite code says so',
  (householdSrc.match(/\{error \?/g) ?? []).length >= 2,
  'createInvite writes an error that only the OTHER sheet renders'
);
const detailSrc = readFileSync(join(ROOT, 'src', 'app', '(app)', 'expense', '[id].tsx'), 'utf8');
check(
  'restoring an expense reports its failure',
  /restore = useMutation/.test(detailSrc),
  'unvoid_expense is called with its result discarded and no loading state'
);
check(
  'the edit path does not leak raw Postgres text',
  !/setError\(rpcError\.message\)/.test(detailSrc) && !/: insertError\.message/.test(detailSrc),
  'expense/[id].tsx shows the raw message instead of humanError()'
);
check(
  'the CSV export does not leak raw error text',
  /humanError/.test(readFileSync(join(ROOT, 'src', 'lib', 'backup.ts'), 'utf8')),
  'backup.ts returns e.message straight into an Alert'
);

// ---- polish and the last correctness nits (Stage 4) ------------------------

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

// A payment recorded the wrong way round does not correct a debt, it creates
// one — and the ledger swallows it because the numbers still sum to zero.
const recordFn = latestDefinitionOf('record_settlement');
check(
  'a payment from someone who owes nothing is refused',
  !!recordFn && /member_balance\(p_from\)/.test(recordFn.body),
  'record_settlement books any direction without checking who actually owes'
);

// An unknown notification kind crashed the whole Activity screen: the switch
// returned undefined and the caller destructured it.
const notifSrc = read('src', 'app', '(app)', 'notifications.tsx');
check(
  'an unknown notification kind cannot crash Activity',
  /default:/.test(notifSrc) && /FALLBACK_ICON/.test(notifSrc),
  'describe() has no default case, so a kind added by a migration takes the screen down'
);

// A "varies" bill nobody entered used to vanish at the month rollover.
check(
  'bills that were never entered are chased',
  /overdue/.test(read('src', 'lib', 'queries.ts')) &&
    /NEVER ENTERED/.test(read('src', 'app', '(app)', 'recurring.tsx')),
  'useRecurring looks only at the current month, so a missed bill disappears silently'
);
check(
  'a late bill is dated the day it fell due',
  /dueDate/.test(read('src', 'app', '(app)', 'recurring.tsx')),
  'post_recurring_now defaults p_date to today, so a bill due the 5th is dated the 20th'
);

// Navigation.
check(
  'owner tools does not stack a second tab shell',
  !/router\.push\('\/'\)/.test(read('src', 'app', '(app)', 'owner.tsx')),
  "push('/') stacks another copy of the tab shell; the file's own comment says to navigate"
);
check(
  'a tab root has no dead back button',
  /showBack=\{false\}/.test(read('src', 'app', '(app)', '(tabs)', 'calculator.tsx')),
  'the Calculator tab renders a back chevron with nothing to pop'
);
check(
  'the recurring form does not swallow the first tap',
  /keyboardShouldPersistTaps/.test(read('src', 'app', '(app)', 'recurring.tsx')),
  'Post takes two taps with the keyboard up'
);

// Charts.
check(
  'chart bars are tappable, not just their labels',
  /barHit/.test(read('src', 'components', 'charts', 'bar-chart.tsx')),
  'the <Rect>s sit in a bare <Svg>, which takes no touches'
);
check(
  'a zero total does not render NaN%',
  /currentTotal > 0 \?/.test(read('src', 'app', '(app)', '(tabs)', 'reports.tsx')),
  'amount / 0 reaches the width string and the label as the literal NaN%'
);
check(
  'reports cannot page into the future',
  /atLatest/.test(read('src', 'app', '(app)', '(tabs)', 'reports.tsx')),
  'the month chevron runs forward through empty months forever'
);

// Layout at the extremes.
check(
  'a long household name does not push the row apart',
  /rowLabel: \{ flexShrink: 1 \}/.test(read('src', 'app', '(app)', 'settings.tsx')),
  'flexShrink: 0 shoves the value and chevron off the card'
);
check(
  'large amounts shrink rather than wrap',
  /adjustsFontSizeToFit/.test(read('src', 'app', '(app)', '(tabs)', 'index.tsx')),
  'Rs 10,00,000+ wraps the hero and the two pager pages stop matching height'
);
check(
  'category glyphs do not clip at large system font',
  /allowFontScaling=\{false\}/.test(read('src', 'app', '(app)', '(tabs)', 'history.tsx')),
  'an 18px emoji in a fixed 38x38 tile clips at 200% font'
);

// The one real performance cliff.
const auditSrc = read('src', 'app', '(app)', 'edit-history.tsx');
check(
  'the 200-row change log is virtualized',
  /FlatList/.test(auditSrc) && !/<ScrollView/.test(auditSrc),
  'edit-history mounts every row eagerly in a plain ScrollView'
);

// Money typed by hand.
check(
  'a comma decimal mark is not silently dropped',
  /decimalComma/.test(read('src', 'lib', 'money.ts')),
  'on a comma-decimal keyboard "12,50" becomes Rs 1,250.00'
);
check(
  'the split is checked before it is sent',
  /assertBalanced\(/.test(read('src', 'components', 'expense-form.tsx')),
  'assertBalanced is tested and called by nothing'
);

// Shipped strings.
// "no shipped error names a developer" lives in domain.test.ts instead: it
// calls humanError() and inspects what actually comes out, which a text scan
// of the file cannot do without also flagging the comment that records what
// the string used to say.
check(
  'a confirmation email can be resent',
  /auth\.resend/.test(read('src', 'app', 'register.tsx')),
  'there is no way to ask for another confirmation email'
);
check(
  'the push row explains itself',
  /PUSH_LABELS\[push\]\.hint/.test(read('src', 'app', '(app)', 'settings.tsx')),
  'push.ts writes a hint for every state and settings renders none'
);

// The local-first layer that never existed.
check(
  'the dead SQLite scaffolding is gone',
  !existsSync(join(ROOT, 'src', 'db')) && !existsSync(join(ROOT, 'drizzle.config.ts')),
  'src/db documents a background sync worker the app does not have'
);

// ---- SQL that only Postgres would have caught ------------------------------
//
// A `language sql` body is a STATEMENT, not an expression. Written without a
// leading `select`, member_balance() parsed fine to every tool here and failed
// on apply with "syntax error at or near coalesce" — the sort of thing that is
// only found by pasting into the SQL editor, which is exactly why it is worth
// a cheap textual check.
{
  const bodies = [];
  for (const f of migs) {
    const text = readFileSync(join(migDir, f), 'utf8');
    const re = /language sql[^$]*as \$(\w*)\$([\s\S]*?)\$\1\$/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const first = m[2].replace(/^(?:--[^\n]*\n|\s)+/, '').toLowerCase();
      bodies.push({ file: f, ok: /^(select|with|insert|update|delete|values)\b/.test(first) });
    }
  }
  const broken = bodies.filter((b) => !b.ok).map((b) => b.file);
  check(
    'every language-sql body is a statement',
    broken.length === 0,
    broken.join(', ') || `${bodies.length} checked`
  );
}

// A signed unit inside a single interval literal -- interval '1 month - 1 day'
// -- is parsed when the expression RUNS, not when the function is created. So
// a bad one applies cleanly and throws on the first app open instead. Two
// separate intervals are unambiguous and cost nothing.
{
  const offenders = migs.filter((f) =>
    /interval '[^']*\d[^']*-[^']*'/.test(readFileSync(join(migDir, f), 'utf8'))
  );
  check(
    'no interval literal hides a sign',
    offenders.length === 0,
    offenders.join(', ')
  );
}

// ---- the server and the app must agree on what "today" is -----------------
//
// `show timezone` on this project returns UTC and the household is in IST, so
// current_date is a day behind for the first five and a half hours of every
// morning -- while src/lib/dates.ts sends device-local dates and says, in
// writing, that this is exactly the drift it exists to avoid.
{
  const TZ_SENSITIVE = [
    'post_recurring_now',
    'post_due_recurrences',
    'record_settlement',
    'remove_member',
    'add_placeholder_member',
  ];
  check(
    'there is one definition of "today"',
    !!latestDefinitionOf('household_today'),
    'household_today() is gone, so calendar decisions fall back to UTC'
  );
  const stragglers = TZ_SENSITIVE.filter((fn) => {
    const def = latestDefinitionOf(fn);
    return !def || !/household_today/.test(def.body);
  });
  check(
    'every calendar decision asks the household, not the server',
    stragglers.length === 0,
    stragglers.join(', ') || `${TZ_SENSITIVE.length} checked`
  );
}

// ---- what a member may do without asking (migration 0031) ------------------
//
// Two rules that fit a landlord and not four friends: you could not correct
// your own typo, and you could not add the category for the thing you buy.

const editFn = latestDefinitionOf('can_self_edit');
check(
  'there is one definition of "may I edit this"',
  !!editFn,
  'can_self_edit() is gone, so the screen and the policy can drift apart again'
);
check(
  'the edit window is a household setting, not a constant',
  !!editFn && /self_edit_minutes/.test(editFn.body),
  'the window is hardcoded, so changing it needs a migration'
);
check(
  'the expenses policy is no longer owner-only',
  /policy expenses_update[\s\S]{0,400}can_self_edit/.test(migAll) &&
    !/create policy expenses_owner_update/.test(
      migs.slice(-1).map((f) => readFileSync(join(migDir, f), 'utf8')).join('')
    ),
  'expenses_owner_update is back, so a member cannot fix their own typo'
);

// The screen must ask the server, not re-derive the window rule in TypeScript
// — that duplication is the failure mode this codebase keeps producing.
const detail = readFileSync(join(ROOT, 'src', 'app', '(app)', 'expense', '[id].tsx'), 'utf8');
check(
  'the expense screen asks the server whether it may edit',
  /canEditDirectly/.test(readFileSync(join(ROOT, 'src', 'lib', 'queries.ts'), 'utf8')) &&
    /canEditNow/.test(detail),
  'the edit window is re-derived client-side and will drift from the policy'
);
check(
  'the expense screen no longer decides by role',
  !/const isOwner/.test(detail),
  'it is back to asking "am I the owner" instead of "may I write this"'
);

// Additive things a member may now do, and the one they still may not.
check(
  'a member can add a category',
  /policy categories_member_insert/.test(migAll),
  'adding a category is still owner-only'
);
check(
  'a member can only commit THEMSELVES to a recurring bill',
  /policy recurring_member_insert[\s\S]{0,300}paid_by = current_member\(\)/.test(migAll),
  'a member could commit somebody else to paying every month'
);
const recurEdit = readFileSync(join(ROOT, 'src', 'app', '(app)', 'recurring-edit.tsx'), 'utf8');
check(
  'the payer picker does not offer a choice that would be refused',
  /isOwner \? members\.data : members\.data\?\.filter/.test(recurEdit),
  'a member is shown every housemate as a payer and the write then fails'
);

// ---- Settle up shows the relationship, not just the answer (Stage 5) -------
//
// The old "Why this amount?" panel showed four aggregate figures for the
// DEBTOR'S WHOLE POSITION, so a card reading "Vinod -> Lee Rs 52.99" concluded
// "Vinod owes overall Rs 107.00" — two true numbers with nothing explaining the
// gap, and no way to ever show WHICH six expenses.
{
  const settle = read('src', 'app', '(app)', 'settle.tsx');

  // Comments stripped first. A file that EXPLAINS the copy it removed will
  // otherwise fail a check for that copy — the same self-reference that made
  // the KeyboardAvoidingView check flag its own replacement.
  const code = settle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check(
    'the aggregate breakdown panel is gone',
    !/WhyRow/.test(code) && !/owes overall/.test(code),
    'settle.tsx is back to explaining a total nobody asked about'
  );
  check(
    'the expanded card lists actual expenses',
    /pair\.lines\.slice\(0, 3\)\.map/.test(settle),
    'the breakdown is aggregate again — it cannot show which expenses'
  );
  // A card is a preview, not a record. A pair with forty shared expenses used
  // to turn one card into a screen of its own.
  check(
    'the card is capped and links to the full history',
    /and \{pair\.lines\.length - 3\} more/.test(settle) &&
      /pathname: '\/pair\/\[id\]'/.test(settle),
    'the expanded card grows without limit, or there is no way to see the rest'
  );
  check(
    'the simplified plan is labelled as a shortcut',
    /SQUARE IT IN/.test(settle) && /will not match the other two tabs/.test(settle),
    'the plan sits beside the pairwise lists with nothing explaining why the numbers differ'
  );
  check(
    'a pair can be exported',
    /exportPairStatement/.test(settle),
    'there is no way to get the proof out of the app'
  );

  // The third view of the same money in this app. The first two drifted apart
  // twice (migrations 0020 and 0024), so this one is checked, not trusted.
  check(
    'the pairwise view is reconciled against the balance',
    /assertPairwiseReconciles/.test(settle),
    'nothing checks that the itemised lists add up to the balance'
  );
  check(
    'and a drift is surfaced rather than swallowed',
    /pairs\.drift/.test(settle),
    'a reconciliation failure would silently render nothing'
  );
}

// The export must go through csv.ts, which handles RFC 4180 quoting, the Excel
// BOM, and neutralising a description that starts with = or + — all of which a
// hand-rolled join(',') gets wrong on ordinary household input.
{
  const backup = read('src', 'lib', 'backup.ts');
  check(
    'the pair statement uses the CSV encoder',
    /exportPairStatement/.test(backup) && /toCsv\(PAIR_STATEMENT_HEADERS/.test(backup),
    'the pair CSV is built by string concatenation'
  );
  // The ROWS are built in pairwise.ts, which has no Expo imports, so the
  // domain tests can assert that the running total lands on the net it claims.
  // backup.ts keeps only the file and share step, which node cannot run.
  check(
    'the statement content is testable',
    /pairStatementRows/.test(read('src', 'lib', 'pairwise.ts')) &&
      /pairStatementRows/.test(backup),
    'the CSV rows are assembled behind an Expo import and cannot be tested'
  );
  check(
    'the share step is written once, not twice',
    (backup.match(/Sharing\.shareAsync/g) ?? []).length === 1,
    'exportBackup and exportPairStatement each have their own copy'
  );
  check(
    'csv.ts stays free of Expo imports',
    !/expo-/.test(read('src', 'lib', 'csv.ts')),
    'csv.ts pulled in a native module and the domain tests can no longer run it'
  );
}

// Only confirmed settlements, matching member_balances (migration 0019).
check(
  'the pairwise query counts confirmed settlements only',
  /usePairwiseLedger[\s\S]{0,1600}\.not\('confirmed_at', 'is', null\)/.test(
    read('src', 'lib', 'queries.ts')
  ),
  'an unconfirmed payment would move the pairwise net but no balance'
);

// ---- one view at a time on Settle up ---------------------------------------
//
// The three sections stacked meant scrolling past two lists to reach the one
// you opened the screen for — and the two pairwise lists answer opposite
// questions, so there is no reading where both are wanted at once.
{
  const settle = read('src', 'app', '(app)', 'settle.tsx');

  check(
    'the three views are a filter, not a stack',
    /<Segmented/.test(settle) && /view === 'plan'/.test(settle),
    'settle.tsx renders all three sections at once again'
  );
  check(
    'the default tab is derived, not stored',
    /const auto: SettleView/.test(settle) && /picked \?\? auto/.test(settle),
    'a useState initialiser runs before the lists load and lands on the wrong tab'
  );
  check(
    'an empty tab says so',
    /EmptyView/.test(settle),
    'selecting a tab with nothing in it shows blank space, which reads as a failed load'
  );
  // The WHEN control in expense-form looks identical and is NOT the same
  // thing: its third segment opens a date picker rather than selecting a
  // value. Unifying them would mean bolting an escape hatch onto every
  // segment, and the first tidy-up would break the picker.
  check(
    'the date picker was not folded into the shared control',
    /setPickingDate\(true\)/.test(read('src', 'components', 'expense-form.tsx')),
    'expense-form lost its date picker to a generic segmented control'
  );

  // A recorded payment does not move a balance until the payee confirms it
  // (0026), and the plan is built from confirmed balances only -- so the
  // transfer stays on the list with the same amount. The card has to say so
  // where the button was, or the only conclusion available is that the tap
  // failed, and the next tap files a duplicate.
  check(
    'a recorded payment leaves a disabled button, not a missing one',
    /function planAction/.test(settle) && /disabled=\{action\.disabled\}/.test(settle),
    'the action button vanishes once a payment is pending, which reads as the tap having failed'
  );
  check(
    'the pending state is not the same colour as the live one',
    /variant: 'secondary' as const/.test(settle) && /variant: 'primary' as const/.test(settle),
    'opacity is the only difference between "do this" and "already done"'
  );
  check(
    'and it says who it is waiting on',
    /Waiting for \$\{nameOf\(t\.to\)\}/.test(settle),
    'the disabled button gives no reason, so it reads as broken rather than sent'
  );
  // `auto` lands anyone who owes money on the You owe tab, and that tab had no
  // action on it at all -- the person who opened Settle up to pay was offered
  // "View all" and "Download".
  check(
    'the You owe tab has a way to act',
    /title="Settle this"/.test(settle) && /show\('plan'\)/.test(settle),
    'the tab a debtor lands on by default is a dead end again'
  );
  // Pairwise nets sum to the balance rather than each being constrained, so
  // owing one person while coming out ahead overall is normal -- and then the
  // plan has no payment for you. Offering "Settle this" there sends someone to
  // a tab with nothing of theirs on it.
  check(
    'and it does not offer to settle what the plan will not ask for',
    /const iPayInPlan/.test(settle) && /iPayInPlan \?/.test(settle),
    'the settle route is offered even when the plan has no payment from you'
  );
  check(
    'changing tab shows the top of the new one',
    /ref=\{scroller\}/.test(settle) && /scrollTo\(\{ y: 0/.test(settle),
    'switching from a long list to a short one leaves you in blank space'
  );
  // setError was write-only: nothing cleared it, so one refusal stayed on
  // screen under every later success and made a single failure look total.
  check(
    'a stale settle error does not outlive the attempt',
    (settle.match(/onMutate: \(\) => setError\(null\)/g) ?? []).length === 2,
    'an error from one transfer persists under the next one that works'
  );
}

// ---- the pair history screen ----------------------------------------------
{
  const pairScreen = join(ROOT, 'src', 'app', '(app)', 'pair', '[id].tsx');
  check(
    'the full history has a screen of its own',
    existsSync(pairScreen),
    'there is nowhere to see more than the three most recent lines'
  );

  const src = readFileSync(pairScreen, 'utf8');
  check(
    'and it is registered in the stack',
    /name="pair\/\[id\]"/.test(read('src', 'app', '(app)', '_layout.tsx')),
    'the route file exists but the navigator does not declare it, so pushing it does nothing'
  );
  check(
    'every expense on it opens',
    /router\.push\(`\/expense\/\$\{l\.id\}`\)/.test(src),
    'the rows are not tappable, so you cannot see who paid or how many ways it split'
  );
  // Settlements are not expenses and have no detail screen — the same
  // reasoning edit-history.tsx uses for its own rows.
  check(
    'a settlement row is not offered as tappable',
    /const openable = l\.kind === 'expense'/.test(src),
    'tapping a payment navigates to an expense id that does not exist'
  );
  check(
    'the long list is virtualized',
    /FlatList/.test(src) && !/<ScrollView/.test(src),
    'a pair with a year of history mounts every row eagerly'
  );
  check(
    'it reuses the pairwise query rather than refetching',
    /usePairwiseLedger/.test(src),
    'the screen computes its own totals and can disagree with Settle up'
  );
  check(
    'it can export the same pair',
    /exportPairStatement/.test(src),
    'the CSV is only reachable from the card'
  );
  // The net shown with its working, and the working computed in the pure
  // module so it can be asserted — not a reduce() inside a component.
  check(
    'the net is shown with its working',
    /pairSummary\(/.test(src) && /You covered for/.test(src),
    'the screen states a total and offers nothing to check it against'
  );
}

// Two verbs, equal weight, side by side. "See all 5 things" read as a sentence
// rather than a button, and the count was already on the card twice.
check(
  'the pair card actions sit side by side',
  /pairActions/.test(read('src', 'app', '(app)', 'settle.tsx')) &&
    /title="View all"/.test(read('src', 'app', '(app)', 'settle.tsx')),
  'the two actions are stacked, or the label is a sentence'
);

// ---- a downloaded update must not report as "nothing new" -----------------
//
// EXPO_UPDATES_CHECK_ON_LAUNCH is ALWAYS with LAUNCH_WAIT_MS 0, so the app
// fetches in the background and applies on the NEXT launch. By the time
// somebody taps Check for updates, the new bundle is already on the phone --
// so checkForUpdateAsync() answers "nothing newer", and the screen said "You
// are on the latest version" while still showing the old build number. Both
// statements true; together they made a live update look unpublished.
{
  const info = read('src', 'lib', 'build-info.ts');
  const settings = read('src', 'app', '(app)', 'settings.tsx');

  check(
    'a pending update is its own outcome',
    /kind: 'pending'/.test(info),
    "checkForUpdate collapses an already-downloaded update into 'none'"
  );
  check(
    'the pending flag comes from the hook that has it',
    /useUpdates\(\)/.test(settings) && /checkForUpdate\(isUpdatePending\)/.test(settings),
    'nothing reads isUpdatePending, so a downloaded update is invisible'
  );
  check(
    'and a pending update offers the restart that applies it',
    /outcome\.kind === 'downloaded' \|\| outcome\.kind === 'pending'/.test(settings),
    'the restart prompt is only reachable on a fresh download, never on a pending one'
  );
}

// ---- a plan payment must say how much of it is passing through ------------
//
// simplifyDebts() plans from HOUSEHOLD balances, so the amount on a plan card
// is the payer's whole balance, not what they owe the person named on it.
// Madhav was asked for Rs 1,590.75 when he owed Mani Rs 1,182.33; the other
// Rs 408.42 was his debt to Lee and Vinod routed through Mani. The card said
// only "Settles both of them", so Mani later found Rs 408.42 against a man who
// was square with the house and had just paid him, with nothing on any screen
// connecting the two.
{
  const settle = read('src', 'app', '(app)', 'settle.tsx');
  const pair = read('src', 'app', '(app)', 'pair', '[id].tsx');
  const payments = read('src', 'app', '(app)', 'settlements.tsx');

  check(
    'the plan card breaks a routed payment into its two halves',
    /splitPayment\(/.test(settle) && /Routed through/.test(settle),
    'the card names a total with no indication that part of it is somebody else’s debt'
  );
  check(
    'and only when something is actually routed',
    /routedPaise > 0 \? split : null/.test(settle),
    'an ordinary pairwise settle-up gets an explanation it does not need'
  );
  check(
    'the payer is told the residue this leaves behind',
    /Afterwards "Owed to you"/.test(settle) && /Afterwards "You owe"/.test(settle),
    'the consequence is discovered on the other tab a week later instead of stated up front'
  );

  // The retroactive half. Nothing was stored about routing when these payments
  // were recorded, so every screen reconstructs it from the pair -- which is
  // what makes it work for the payment Mani is looking at today.
  check(
    'a settled pair explains a residue left by routing',
    /routingNotes\(/.test(settle) && /pairRouting\(/.test(settle),
    'the card still explains the residue only as "you come out ahead"'
  );
  check(
    'the pair history says how much never concerned the two of them',
    /pairRouting\(/.test(pair) && /routed for somebody else/.test(pair),
    'the full list shows a payment total with no note that part of it was passing through'
  );
  check(
    'the payments list splits a routed payment too',
    /usePairwiseLedger\(/.test(payments) && /routed onward/.test(payments),
    'the screen where the amount was first seen still shows only the bank figure'
  );
  check(
    'an undone payment carries no routing note',
    /routed && !voided/.test(payments),
    'a voided payment claims to have settled something'
  );
}

let failed = 0;
console.log('## structure');
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
