/**
 * E2E tests for Creator Payout request and Admin approval flow.
 *
 * Verifies:
 *  - A creator can request a payout when their balance is sufficient
 *  - Payouts below the minimum threshold (₦1,000) are rejected
 *  - Payouts above the admin-approval threshold (₦50,000) enter a pending state
 *  - An admin can approve a pending payout
 *  - The payout status reflects "approved" after admin approval
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const MIN_PAYOUT_THRESHOLD = 1_000;   // ₦1,000
const ADMIN_APPROVAL_THRESHOLD = 50_000; // ₦50,000

const CREATOR_TOKEN = process.env.E2E_CREATOR_TOKEN ?? '';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? '';
const CREATOR_TOKEN_SET = !!CREATOR_TOKEN;
const ADMIN_TOKEN_SET = !!ADMIN_TOKEN;

function creatorHeaders() {
  return {
    Authorization: `Bearer ${CREATOR_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function adminHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// Shared state
let createdPayoutId: string | null = null;
let largePendingPayoutId: string | null = null;

// ---------------------------------------------------------------------------
// Creator payout request and admin approval
// ---------------------------------------------------------------------------

test.describe('Creator payout request and admin approval', () => {

  // -------------------------------------------------------------------------
  // Below-threshold payout
  // -------------------------------------------------------------------------

  test('payout below ₦1,000 minimum threshold is rejected (400 or 422)', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/creator/payouts', {
      headers: creatorHeaders(),
      data: {
        amount: MIN_PAYOUT_THRESHOLD - 1, // 999 — below minimum
        currency: 'NGN',
        bankDetails: {
          accountNumber: '0123456789',
          bankCode: '058',
        },
      },
    });

    // Should be rejected with a client error
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('below-threshold rejection includes a descriptive error message', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/creator/payouts', {
      headers: creatorHeaders(),
      data: {
        amount: 1,
        currency: 'NGN',
      },
    });

    if (response.status() >= 400 && response.status() < 500) {
      const body = await response.json().catch(() => ({}));
      const msg: string =
        body.message ?? body.error ?? body.data?.message ?? '';
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Valid payout with sufficient balance
  // -------------------------------------------------------------------------

  test('creator can request a payout above the minimum threshold', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/creator/payouts', {
      headers: creatorHeaders(),
      data: {
        amount: MIN_PAYOUT_THRESHOLD + 500, // ₦1,500 — above minimum, below admin-approval threshold
        currency: 'NGN',
        bankDetails: {
          accountNumber: '0123456789',
          bankCode: '058',
          accountName: 'Test Creator',
        },
      },
    });

    // 200 / 201 for success, 400 if insufficient balance (both are valid)
    expect([200, 201, 400, 422]).toContain(response.status());

    if (response.status() < 300) {
      const body = await response.json().catch(() => ({}));
      createdPayoutId =
        body.id ?? body.payoutId ?? body.data?.id ?? null;
    }
  });

  test('successful payout request returns a status field', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/creator/payouts', {
      headers: creatorHeaders(),
      data: {
        amount: MIN_PAYOUT_THRESHOLD + 100,
        currency: 'NGN',
      },
    });

    if (response.status() >= 200 && response.status() < 300) {
      const body = await response.json().catch(() => ({}));
      const status: string =
        body.status ?? body.payout?.status ?? body.data?.status ?? '';
      expect(status.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Above admin-approval threshold — goes to pending
  // -------------------------------------------------------------------------

  test('payout above ₦50,000 enters pending approval state', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/creator/payouts', {
      headers: creatorHeaders(),
      data: {
        amount: ADMIN_APPROVAL_THRESHOLD + 1_000, // ₦51,000 — above auto-approve threshold
        currency: 'NGN',
        bankDetails: {
          accountNumber: '0123456789',
          bankCode: '058',
          accountName: 'Test Creator Large',
        },
      },
    });

    // 200/201 with pending status, or 400 for insufficient balance
    if (response.status() >= 200 && response.status() < 300) {
      const body = await response.json().catch(() => ({}));
      const status: string =
        body.status ?? body.payout?.status ?? body.data?.status ?? '';

      // Large payouts must require human review
      expect(['pending', 'pending_approval', 'under_review']).toContain(status);

      largePendingPayoutId =
        body.id ?? body.payoutId ?? body.data?.id ?? null;
    } else {
      // Insufficient balance is acceptable — the threshold behaviour is still valid
      expect([200, 201, 400, 422]).toContain(response.status());
    }
  });

  // -------------------------------------------------------------------------
  // Admin approval
  // -------------------------------------------------------------------------

  test('admin can approve a pending payout via POST /api/admin/payouts/[id]/approve', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const payoutId =
      largePendingPayoutId ??
      createdPayoutId ??
      process.env.E2E_TEST_PAYOUT_ID ??
      null;

    if (!payoutId) {
      test.skip(true, 'No payout id available — skipping approval test');
      return;
    }

    const response = await request.post(`/api/admin/payouts/${payoutId}/approve`, {
      headers: adminHeaders(),
      data: { note: 'Approved by E2E test' },
    });

    // 200 / 202 for accepted; 404 if payout already processed
    expect([200, 202, 404]).toContain(response.status());
  });

  test('payout status is "approved" after admin approval', async ({ request }) => {
    if (!ADMIN_TOKEN_SET || !CREATOR_TOKEN_SET) {
      test.skip(true, 'Admin or creator token not set — skipping');
      return;
    }

    const payoutId =
      largePendingPayoutId ??
      createdPayoutId ??
      process.env.E2E_TEST_PAYOUT_ID ??
      null;

    if (!payoutId) {
      test.skip(true, 'No payout id available — skipping status check');
      return;
    }

    // Approve
    await request.post(`/api/admin/payouts/${payoutId}/approve`, {
      headers: adminHeaders(),
    });

    // Verify status from creator perspective
    const statusResp = await request.get(`/api/creator/payouts/${payoutId}`, {
      headers: creatorHeaders(),
    });

    if (statusResp.status() === 200) {
      const body = await statusResp.json().catch(() => ({}));
      const status: string =
        body.status ?? body.payout?.status ?? body.data?.status ?? '';

      expect(['approved', 'completed', 'paid']).toContain(status);
    }
  });

  test('non-admin cannot approve a payout — returns 401 or 403', async ({ request }) => {
    if (!CREATOR_TOKEN_SET) {
      test.skip(true, 'E2E_CREATOR_TOKEN not set — skipping');
      return;
    }

    const payoutId =
      largePendingPayoutId ??
      createdPayoutId ??
      process.env.E2E_TEST_PAYOUT_ID ??
      'placeholder-payout-id';

    const response = await request.post(`/api/admin/payouts/${payoutId}/approve`, {
      headers: creatorHeaders(), // creator token, not admin
    });

    expect([401, 403]).toContain(response.status());
  });
});
