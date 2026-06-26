import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Generic minor-unit helpers (currency-agnostic)
// ---------------------------------------------------------------------------

/**
 * Convert an integer minor-unit amount (e.g. kobo, cents) to a formatted
 * decimal string with a leading currency symbol.
 *
 * @param amount      - Amount in minor units (e.g. 10050 kobo = ₦100.50)
 * @param symbol      - Currency symbol prefix (default: '')
 * @param divisor     - Minor units per major unit (default: 100)
 */
export function minorUnitToStr(amount: number, symbol = '', divisor = 100): string {
  return symbol + new Decimal(amount).div(divisor).toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Convert an integer minor-unit amount to a Decimal for further arithmetic.
 */
export function minorUnitToDecimal(amount: number, divisor = 100): Decimal {
  return new Decimal(amount).div(divisor);
}

/**
 * Convert an integer minor-unit amount to the floored major-unit integer.
 */
export function minorUnitToInt(amount: number, divisor = 100): number {
  return new Decimal(amount).div(divisor).floor().toNumber();
}

// ---------------------------------------------------------------------------
// Naira / Kobo convenience aliases (backward-compatible)
// ---------------------------------------------------------------------------

export function koboToNairaStr(kobo: number): string {
  return minorUnitToStr(kobo, '₦', 100);
}

export function koboToDecimal(kobo: number): Decimal {
  return minorUnitToDecimal(kobo, 100);
}

export function koboToNairaInt(kobo: number): number {
  return minorUnitToInt(kobo, 100);
}
