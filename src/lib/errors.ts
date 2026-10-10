/**
 * One place that turns whatever went wrong into a sentence a flatmate can act
 * on.
 *
 * Before this, eighteen screens did `e instanceof Error ? e.message : String(e)`
 * and showed the result in an Alert. That is fine for the messages this app
 * raises itself -- the RPCs in supabase/migrations say things like "Only the
 * owner can remove people from the household" on purpose -- but it also meant
 * Postgres internals reached people verbatim:
 *
 *   new row violates row-level security policy for table "expenses"
 *   insert or update on table "expense_splits" violates foreign key constraint
 *
 * So messages we wrote pass through untouched, messages Postgres wrote get
 * translated, and anything unrecognised falls back to something honest rather
 * than leaking schema names.
 */

type Maybe = { code?: string; message?: string; details?: string; hint?: string };

/** Postgres and PostgREST codes worth naming. */
const BY_CODE: Record<string, string> = {
  // Foreign key. In this schema it almost always means "that person or
  // category is referenced by an expense", which is deliberate.
  '23503': 'Something still refers to this, so it cannot be removed. Its history has to stay.',
  '23505': 'That already exists.',
  '23514': "That value isn't allowed here.",
  // RLS refused the write. Never the user's fault in a useful sense, so say
  // what it means rather than naming the policy.
  '42501': "You don't have permission to do that.",
  '42P01': 'The app is out of date with the database. Reinstall the latest build.',
  PGRST202: 'The app is out of date with the database. Reinstall the latest build.',
  PGRST301: 'Your session expired. Sign in again.',
  '22P02': "That value isn't in a format the app understands.",
  '40001': 'Someone else was saving at the same moment. Try again.',
  '57014': 'That took too long. Try again.',
};

/** Exact messages from Supabase auth, which are terse rather than wrong. */
const BY_MESSAGE: Record<string, string> = {
  'Invalid login credentials': 'That email and password do not match.',
  'Email not confirmed': 'Open the confirmation link we emailed you, then sign in.',
  'User already registered': 'There is already an account with that email.',
  'Password should be at least 6 characters': 'Use at least 8 characters.',
  'Auth session missing!': 'Your session expired. Sign in again.',
  'Network request failed': 'No connection. This will send itself when you are back online.',
  // Supabase's shared SMTP allows only a couple of emails per hour per
  // project, and sign-up confirmations, password resets and email-change
  // confirmations all draw on the same budget. The message it returns says
  // nothing about what to do.
  //
  // The wording is deliberately for a FLATMATE, not for whoever set the
  // project up. It used to read "Ask Mohan to turn off email confirmation in
  // Supabase" -- a named person and a backend setting, shipped inside the APK
  // to people who can do nothing about either.
  'Email rate limit exceeded':
    'Too many emails have gone out from this app in the last hour. Try again in an hour.',
  'For security purposes, you can only request this after 60 seconds.':
    'Wait a minute and try again.',
  'Failed to fetch': 'No connection. This will send itself when you are back online.',
};

/**
 * Phrases that only ever appear in machine-generated database errors. Used to
 * decide whether an unrecognised message is safe to show as-is.
 */
const DATABASE_JARGON = [
  'violates',
  'constraint',
  'relation ',
  'column ',
  'syntax error',
  'permission denied for',
  'null value in',
  'invalid input syntax',
  'does not exist',
  'duplicate key',
  'row-level security',
  'search_path',
  'PGRST',
];

/** Matched case-insensitively on a substring, for messages whose exact
 *  wording drifts between Supabase releases. */
const BY_FRAGMENT: [string, string][] = [
  ['rate limit', 'Too many emails have gone out from this app in the last hour. Try again in an hour.'],
  ['over_email_send_rate_limit', 'Too many emails in the last hour. Try again later.'],
];

const FALLBACK = 'That did not work. Try again — and tell whoever set this household up if it keeps happening.';

/**
 * The fallback, with the Postgres error code kept on the end.
 *
 * The point of this file is that a flatmate never reads a schema name, and that
 * still holds -- a bare SQLSTATE names nothing. What it does is tell the person
 * who CAN fix it which of about forty failures they are looking at.
 *
 * Without it the fallback is unfalsifiable. A settle-up bug took three rounds
 * to place because "That did not work" was true of a missing grant, a refused
 * policy and a not-null violation alike, and the one fact that separated them
 * was thrown away at this line. `(42501)` on the end would have placed it in
 * one.
 */
function fallbackFor(code: string | undefined): string {
  return code ? `${FALLBACK} (${code})` : FALLBACK;
}

export function humanError(e: unknown): string {
  const err = (typeof e === 'object' && e !== null ? e : {}) as Maybe;
  const raw = (err.message ?? (typeof e === 'string' ? e : '')).trim();

  if (err.code && BY_CODE[err.code]) return BY_CODE[err.code];
  if (raw && BY_MESSAGE[raw]) return BY_MESSAGE[raw];

  // Our own RPCs raise with P0001 and already read as English.
  if (err.code === 'P0001' && raw) return raw;

  if (!raw) return fallbackFor(err.code);

  const lower = raw.toLowerCase();

  for (const [fragment, message] of BY_FRAGMENT) {
    if (lower.includes(fragment.toLowerCase())) return message;
  }

  if (DATABASE_JARGON.some((phrase) => lower.includes(phrase.toLowerCase()))) {
    return fallbackFor(err.code);
  }

  // Long enough to be a stack trace or a wall of SQL rather than a sentence.
  if (raw.length > 200) return fallbackFor(err.code);

  return raw;
}
