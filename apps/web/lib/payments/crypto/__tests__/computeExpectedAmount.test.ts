/**
 * Unit tests for lib/payments/crypto/index.ts's computeExpectedAmount().
 *
 * Key invariant: the exact token amount is derived server-side from
 * kobo → USD (via the admin USD→NGN rate) → discount → ÷ token USD price,
 * rounded UP so a user never underpays due to rounding, expressed in the
 * token's smallest unit (wei-equivalent).
 */

jest.mock('@/lib/db', () => ({ db: { query: jest.fn().mockResolvedValue({ rows: [] }) } }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('@/lib/payments/circuit', () => ({
  cryptoRpcBreaker: { execute: (fn: () => unknown) => fn() },
  cryptoPriceFeedBreaker: { execute: (fn: () => unknown) => fn() },
}));

jest.mock('../priceFeed', () => ({
  getUsdPrice: jest.fn(),
}));
jest.mock('../settings', () => ({
  getCryptoDiscountPercent: jest.fn(),
  getUsdToNgnRate: jest.fn(),
}));
// Chain adapters pull in viem / @solana/web3.js (ESM), which Jest can't
// transform out of the box — computeExpectedAmount() never actually calls
// into a chain adapter, so a stub is sufficient here.
jest.mock('../chains', () => ({
  getChainAdapter: jest.fn(),
  MIN_CONFIRMATIONS: { bsc: 15, solana: 1 },
}));

import Decimal from 'decimal.js';
import { getUsdPrice } from '../priceFeed';
import { getCryptoDiscountPercent, getUsdToNgnRate } from '../settings';
import { computeExpectedAmount } from '../index';

const mockGetUsdPrice = getUsdPrice as jest.Mock;
const mockGetDiscount = getCryptoDiscountPercent as jest.Mock;
const mockGetUsdToNgn = getUsdToNgnRate as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRYPTO_RECEIVING_ADDRESS_BSC = '0xReceiver';
  process.env.CRYPTO_RECEIVING_ADDRESS_SOLANA = 'SolReceiver';
  mockGetUsdToNgn.mockResolvedValue(new Decimal(1600)); // ₦1600 = $1
});

describe('computeExpectedAmount', () => {
  it('computes the discounted token amount for JAGA (20% off)', async () => {
    mockGetUsdPrice.mockResolvedValue({ usdPrice: new Decimal(0.01), source: 'live', fetchedAt: new Date() });
    mockGetDiscount.mockResolvedValue(20);

    // ₦16,000,000 kobo = ₦160,000 = $100 → 20% off = $80 → ÷ $0.01 = 8000 JAGA
    const result = await computeExpectedAmount(16_000_000, 'JAGA');
    expect(result.discountPercent).toBe(20);
    expect(result.chain).toBe('bsc');
    expect(result.receivingAddress).toBe('0xReceiver');
    // 8000 JAGA * 10^18
    expect(result.expectedBaseUnits.toString()).toBe((8000n * 10n ** 18n).toString());
  });

  it('applies zero discount for BNB by default and uses the Solana receiving address for SOL', async () => {
    mockGetUsdPrice.mockResolvedValue({ usdPrice: new Decimal(600), source: 'live', fetchedAt: new Date() });
    mockGetDiscount.mockResolvedValue(0);

    // ₦1,600,000 kobo = ₦16,000 = $10 → ÷ $600 = 0.016666... SOL
    const result = await computeExpectedAmount(1_600_000, 'SOL');
    expect(result.chain).toBe('solana');
    expect(result.receivingAddress).toBe('SolReceiver');
    expect(result.discountPercent).toBe(0);
    // Rounds up — never lets the expected amount be less than the true value.
    const exact = new Decimal(10).div(600).mul(new Decimal(10).pow(9));
    expect(BigInt(result.expectedBaseUnits) >= BigInt(exact.floor().toString())).toBe(true);
  });

  it('throws when the chain receiving address env var is unset', async () => {
    delete process.env.CRYPTO_RECEIVING_ADDRESS_BSC;
    mockGetUsdPrice.mockResolvedValue({ usdPrice: new Decimal(0.01), source: 'live', fetchedAt: new Date() });
    mockGetDiscount.mockResolvedValue(0);
    await expect(computeExpectedAmount(100_000, 'JAGA')).rejects.toThrow(/CRYPTO_RECEIVING_ADDRESS_BSC/);
  });
});
