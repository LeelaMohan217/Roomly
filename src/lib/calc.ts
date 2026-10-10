/**
 * The calculator's arithmetic, kept out of the screen so it can be tested.
 *
 * Deliberately NOT integer paise like the rest of this app. Money is stored as
 * paise because a stored balance must never drift, but a calculator has to
 * handle 1/3 and 12.5% too, so it works in floats and the DISPLAY rounds. The
 * one place a result becomes money -- "use in an expense" -- rounds to two
 * decimals before handing over, because parseAmount() refuses more than that.
 */

export type Op = '+' | '-' | '×' | '÷';
export type Token = number | Op;

export const isOp = (t: Token | undefined): t is Op => typeof t === 'string';

/**
 * Evaluates left to right, with x and / binding tighter than + and -.
 *
 * A trailing operator is dropped rather than treated as an error, so a
 * half-typed "120 +" still yields 120 and the screen can show a running total
 * instead of blanking out on every other keystroke.
 *
 * Returns null when there is nothing to show: an empty expression, a division
 * by zero, or a non-finite result.
 */
export function evaluate(tokens: Token[]): number | null {
  const t = isOp(tokens[tokens.length - 1]) ? tokens.slice(0, -1) : [...tokens];
  if (t.length === 0) return null;
  if (typeof t[0] !== 'number') return null;

  // First pass: collapse every x and / so the second pass is pure + and -.
  const pass: Token[] = [t[0]];
  for (let i = 1; i < t.length; i += 2) {
    const op = t[i];
    const rhs = t[i + 1];
    if (!isOp(op) || typeof rhs !== 'number') break;

    if (op === '×' || op === '÷') {
      const lhs = pass.pop() as number;
      if (op === '÷' && rhs === 0) return null;
      pass.push(op === '×' ? lhs * rhs : lhs / rhs);
    } else {
      pass.push(op, rhs);
    }
  }

  let acc = pass[0] as number;
  for (let i = 1; i < pass.length; i += 2) {
    const op = pass[i];
    const rhs = pass[i + 1];
    if (!isOp(op) || typeof rhs !== 'number') break;
    acc = op === '+' ? acc + rhs : acc - rhs;
  }

  return Number.isFinite(acc) ? acc : null;
}

/**
 * A calculator result as a string the expense form will accept.
 *
 * parseAmount() rejects more than two decimals, so 33.333 has to be rounded
 * here rather than silently refused at the other end. Returns null for
 * anything that could not be an expense total.
 */
export function toAmountString(result: number | null): string | null {
  if (result === null || !Number.isFinite(result) || result <= 0) return null;
  const rounded = Math.round(result * 100) / 100;
  if (rounded <= 0) return null;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
