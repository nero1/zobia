import Decimal from 'decimal.js';

export function koboToNairaStr(kobo: number): string {
  return '₦' + new Decimal(kobo).div(100).toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function koboToDecimal(kobo: number): Decimal {
  return new Decimal(kobo).div(100);
}

export function koboToNairaInt(kobo: number): number {
  return new Decimal(kobo).div(100).floor().toNumber();
}
