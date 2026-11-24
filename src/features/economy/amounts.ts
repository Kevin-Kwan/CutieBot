/**
 * The one shared amount parser (PLAN §6, AUDIT §7 test list).
 *
 * The old bot copy-pasted `parseInt` + `all`/`max` handling into ~12
 * callbacks; `parseInt('abc')` → NaN silently poisoned balances and
 * `parseInt('10.5')` truncated. This parser is purely syntactic — it
 * resolves `all`/`max` against the supplied balance and guarantees a
 * positive safe integer, but does NOT check sufficiency (callers produce
 * the user-facing "you only have $X" messages).
 */

export type ParseAmountResult =
  { readonly ok: true; readonly amount: number } | { readonly ok: false; readonly error: string };

const INTEGER_PATTERN = /^[0-9]+$/;

export function parseAmount(input: string, balance: number): ParseAmountResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Enter a valid amount.' };
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Enter a valid amount.' };
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'all' || lowered === 'max') {
    if (!Number.isSafeInteger(balance) || balance <= 0) {
      return { ok: false, error: 'You have nothing to use.' };
    }
    return { ok: true, amount: balance };
  }

  // Digits only: rejects "10.5", "1e30", "Infinity", "-5", "-0", "+5",
  // "0x10", "1,000", "1_000" and any other non-plain-integer spelling.
  if (!INTEGER_PATTERN.test(trimmed)) {
    return { ok: false, error: 'Enter a whole number amount (or "all").' };
  }

  const amount = Number(trimmed);
  if (!Number.isSafeInteger(amount)) {
    return { ok: false, error: 'That amount is too large.' };
  }
  if (amount <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  return { ok: true, amount };
}

/** Guard used by the repository layer before any balance mutation. */
export function isValidAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0;
}
