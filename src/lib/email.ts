/**
 * Email checks that run before anything is sent.
 *
 *   isValidEmail   -- the basic shape: something@something.something. Without
 *                     it, "mohan@" went to Supabase and came back as "Unable
 *                     to validate email address: invalid format".
 *   isProperEmail  -- the shape AND nothing after the @ that is plainly
 *                     mistyped: "gma.con", "gmial.com", "gmail.con". These
 *                     are valid shapes nothing would ever bounce, so without
 *                     this they went through and the email was never seen.
 *
 * Neither can tell whether an inbox exists. Only sending can, and Supabase
 * deliberately does not say (that would reveal who has an account).
 */

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(input.trim());
}

/** Providers people in the house use, spelt right. */
const PROVIDERS = ['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'rediffmail', 'live'];

/**
 * Real addresses that are one letter from a provider above (ymail, mail, gmx)
 * and must not be called mistyped.
 */
const REAL_LOOKALIKES = new Set([
  'ymail.com', 'rocketmail.com', 'mail.com', 'gmx.com', 'aol.com', 'msn.com', 'me.com',
  'mac.com', 'proton.me', 'protonmail.com', 'zoho.com', 'yandex.com',
]);

/** Endings that are only ever a slip of the finger for ".com". */
const COM_TYPOS = new Set(['con', 'cpm', 'cmo', 'vom', 'xom', 'comm', 'coom', 'cm', 'om', 'ocm', 'clm', 'coml']);

/** Edit distance, with a swapped pair ("gmial") counted as one mistake. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? prev : Infinity
      );
      prev = temp;
    }
  }
  return row[b.length];
}

export function isProperEmail(input: string): boolean {
  if (!isValidEmail(input)) return false;

  const domain = input.trim().toLowerCase().split('@').pop()!;
  if (REAL_LOOKALIKES.has(domain)) return true;

  const parts = domain.split('.');
  const ending = parts[parts.length - 1];
  if (COM_TYPOS.has(ending)) return false;

  // "gma", "gmial", "yaho": a provider cut off or misspelt. A correct
  // provider name passes, whatever its ending (yahoo.co.in, outlook.in).
  const name = parts[0];
  //
  // Strict about how close counts, because this one blocks: two slips are
  // allowed only against a long name (gmail, outlook), one against a short
  // name, and none against "live", which is one letter from far too many
  // real domains (love.com, line.me).
  if (parts.length === 2 && !PROVIDERS.includes(name)) {
    const nearProvider = PROVIDERS.some(
      (p) =>
        p !== 'live' &&
        ((name.length >= 3 && p.startsWith(name)) || distance(name, p) <= (p.length >= 5 ? 2 : 1))
    );
    if (nearProvider) return false;
  }
  return true;
}
