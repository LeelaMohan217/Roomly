/**
 * Money is ALWAYS integer paise. Never a float, never a string, never rupees.
 * Floating-point rupees is the classic way to make a shared ledger drift.
 */
export type Paise = number;

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

// Both ends pinned to two decimals. Paise ARE exactly two decimal places, so
// this renders the stored integer in full and nothing else — no rounding, no
// hidden remainder.
//
// minimumFractionDigits used to be 0, so a whole amount showed as ₹700 while a
// split one showed as ₹233.34. That made it impossible to tell, at a glance,
// whether a figure was exact or merely tidy — which is the wrong doubt to have
// about money four people share.
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,234.00 or ₹1,234.50 — the exact stored amount, always. */
export function formatPaise(paise: Paise): string {
  return inr.format(paise / 100);
}

/**
 * Parses free-typed input like "1,234.50" or "1234" into paise.
 *
 * A comma used as the DECIMAL mark is read as one, rather than deleted. Some
 * Android keyboards emit ',' on the decimal key, and stripping it silently
 * turned "12,50" into Rs 1,250.00 — a hundredfold error, typed by hand, in a
 * shared ledger. A comma is treated as a decimal point when exactly one
 * appears with one or two digits after it and no '.' anywhere; otherwise it is
 * a thousands separator and still goes.
 */
export function parseAmount(input: string): Paise | null {
  const decimalComma = /^[^.]*$/.test(input) && /,\d{1,2}$/.test(input.trim());
  const normalised = decimalComma ? input.replace(',', '.') : input;
  const cleaned = normalised.replace(/[₹,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return rupeesToPaise(value);
}
