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
 * What a phone field keeps: digits only, ten at most. +91 is already shown in
 * front of the field, so it holds exactly the mobile number.
 *
 * Not maxLength={10}: that cuts a pasted "+91 98765 43210" to "+91 98765 "
 * before this ever sees it. A whole pasted number loses its +91 or leading 0
 * here instead; anything else stops at the tenth digit.
 */
export function toTenDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/**
 * What is wrong with a phone field's digits, in words, or null if nothing.
 * Ten digits that still fail can only be a wrong first digit, and "enter 10
 * digits" would be wrong when there already are ten.
 */
export function phoneProblem(digits: string): string | null {
  if (normalizePhone(digits)) return null;
  return digits.length === 10
    ? 'Mobile numbers start with 6, 7, 8 or 9.'
    : 'Enter a 10-digit mobile number.';
}

/** "+919876543210" -> "+91 98765 43210", for showing a saved number. */
export function formatPhone(e164: string): string {
  const local = e164.startsWith(PHONE_PREFIX) ? e164.slice(PHONE_PREFIX.length) : e164;
  return local.length === 10
    ? `${PHONE_PREFIX} ${local.slice(0, 5)} ${local.slice(5)}`
    : e164;
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
