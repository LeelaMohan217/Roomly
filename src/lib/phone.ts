/**
 * Phone numbers, for signing in with a number instead of an email.
 *
 * Indian mobiles only for now: ten digits starting 6-9, stored in E.164 form
 * (+91XXXXXXXXXX) so one number has exactly one spelling in the database.
 * "98765 43210", "+91 98765-43210" and "098765 43210" are all the same person
 * and must all find the same account.
 */

export const PHONE_PREFIX = '+91';

/** The stored form of a number someone typed, or null if it is not a mobile. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const local =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? `${PHONE_PREFIX}${local}` : null;
}

/**
 * Does a sign-in entry look like a phone number rather than an email?
 * Digits, spaces and phone punctuation only -- anything with a letter or an @
 * is treated as an email.
 */
export function looksLikePhone(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && /^[+\d\s()-]+$/.test(trimmed);
}
