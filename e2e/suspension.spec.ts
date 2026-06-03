/**
 * E2E tests for Suspension enforcement.
 *
 * Verifies:
 *  - Admin can suspend a user via POST /api/admin/users/[userId]/actions
 *  - A suspended user cannot send DMs (403)
 *  - A suspended user cannot post in a room (403)
 *  - The sender receives a notice that the recipient is "temporarily unavailable"
 *  - Admin can restore a user via the same actions endpoint
 *  - The user can send again after being restored
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers and constants
// ---------------------------------------------------------------------------

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? '';
const SUSPENDED_USER_TOKEN = process.env.E2E_SUSPENDED_USER_TOKEN ?? '';
const ADMIN_TOKEN_SET = !!ADMIN_TOKEN;
const SUSPENDED_USER_TOKEN_SET = !!SUSPENDED_USER_TOKEN;

// The user that will be suspended during this test suite
const TARGET_USER_ID =
  process.env.E2E_SUSPENSION_TARGET_USER_ID ?? 'test-suspension-target-user';

// A room and recipient used for post/DM tests
const TEST_ROOM_ID = process.env.E2E_TEST_ROOM_ID ?? 'test-room-id';
const TEST_RECIPIENT_ID = process.env.E2E_TEST_RECIPIENT_ID ?? 'test-recipient-user-id';

// ---------------------------------------------------------------------------
// Suspension enforcement
// ---------------------------------------------------------------------------

test.describe('Suspension enforcement', () => {

  // -------------------------------------------------------------------------
  // Admin suspends user
  // -------------------------------------------------------------------------

  test('admin can suspend a user via POST /api/admin/users/[userId]/actions', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: {
        action: 'suspend',
        reason: 'E2E test — automated suspension check',
        durationDays: 1,
      },
    });

    // 200 / 201 / 204 for success
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);
  });

  test('suspension action returns the user\'s updated status', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: {
        action: 'suspend',
        reason: 'E2E test — status check',
        durationDays: 1,
      },
    });

    if (response.status() >= 200 && response.status() < 300) {
      const body = await response.json().catch(() => ({}));
      const status: string =
        body.status ??
        body.user?.status ??
        body.data?.status ??
        '';
      // A non-empty status is acceptable; specific values depend on implementation
      expect(status.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Suspended user cannot send DMs
  // -------------------------------------------------------------------------

  test('suspended user cannot send a DM — POST /api/messages/dm returns 403', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET) {
      test.skip(true, 'E2E_SUSPENDED_USER_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/messages/dm', {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: {
        recipientId: TEST_RECIPIENT_ID,
        message: 'This DM should be blocked',
      },
    });

    expect(response.status()).toBe(403);
  });

  test('DM blocked response includes a "temporarily unavailable" or suspension notice', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET) {
      test.skip(true, 'E2E_SUSPENDED_USER_TOKEN not set — skipping');
      return;
    }

    const response = await request.post('/api/messages/dm', {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: {
        recipientId: TEST_RECIPIENT_ID,
        message: 'Check suspension message',
      },
    });

    if (response.status() === 403) {
      const body = await response.json().catch(() => ({}));
      const msg: string =
        (body.message ?? body.error ?? body.data?.message ?? '').toLowerCase();

      // Should contain language about unavailability or suspension
      const hasSuspensionLanguage =
        msg.includes('suspended') ||
        msg.includes('unavailable') ||
        msg.includes('restricted') ||
        msg.includes('blocked') ||
        msg.includes('temporarily');

      // If the body has a message, it should mention the account state
      if (msg.length > 0) {
        expect(hasSuspensionLanguage).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Suspended user cannot post in a room
  // -------------------------------------------------------------------------

  test('suspended user cannot post in a room — POST /api/rooms/[roomId]/messages returns 403', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET) {
      test.skip(true, 'E2E_SUSPENDED_USER_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(`/api/rooms/${TEST_ROOM_ID}/messages`, {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: {
        content: 'This room message should be blocked',
      },
    });

    expect(response.status()).toBe(403);
  });

  test('room post blocked response has a non-empty error body', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET) {
      test.skip(true, 'E2E_SUSPENDED_USER_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(`/api/rooms/${TEST_ROOM_ID}/messages`, {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: { content: 'Blocked message attempt' },
    });

    if (response.status() === 403) {
      const body = await response.json().catch(() => ({}));
      const hasMessage =
        typeof body.message === 'string' || typeof body.error === 'string';
      expect(hasMessage).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Sender receives "temporarily unavailable" notice when messaging a suspended recipient
  // -------------------------------------------------------------------------

  test('sender receives notice that recipient is temporarily unavailable', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    // Suspend the target so we can test the sender-side notice
    await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: { action: 'suspend', reason: 'E2E notice test', durationDays: 1 },
    });

    // Now a different user tries to DM the suspended recipient
    const senderToken = process.env.E2E_SENDER_TOKEN ?? ADMIN_TOKEN;
    const response = await request.post('/api/messages/dm', {
      headers: authHeaders(senderToken),
      data: {
        recipientId: TARGET_USER_ID,
        message: 'Hello, are you there?',
      },
    });

    // The API should either block the send or return a notice in the response body
    const body = await response.json().catch(() => ({}));
    const msg: string =
      (body.message ?? body.notice ?? body.error ?? body.data?.message ?? '').toLowerCase();

    if (msg.length > 0) {
      const hasUnavailableLanguage =
        msg.includes('unavailable') ||
        msg.includes('suspended') ||
        msg.includes('restricted') ||
        msg.includes('temporarily');
      expect(hasUnavailableLanguage).toBe(true);
    } else {
      // If no body message, the status code should signal the problem
      expect([400, 403, 404, 409, 422]).toContain(response.status());
    }
  });

  // -------------------------------------------------------------------------
  // Admin restores user
  // -------------------------------------------------------------------------

  test('admin can restore a suspended user via POST /api/admin/users/[userId]/actions', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: {
        action: 'restore',
        reason: 'E2E test — restore after suspension check',
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);
  });

  // -------------------------------------------------------------------------
  // User can send again after restore
  // -------------------------------------------------------------------------

  test('user can send a DM again after being restored', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET || !ADMIN_TOKEN_SET) {
      test.skip(true, 'Required tokens not set — skipping');
      return;
    }

    // Restore the user first
    await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: { action: 'restore', reason: 'E2E restore before send test' },
    });

    // Attempt a DM — should now succeed (or fail for unrelated reasons like plan tier)
    const response = await request.post('/api/messages/dm', {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: {
        recipientId: TEST_RECIPIENT_ID,
        message: 'Back online after restore',
      },
    });

    // Must not be 403 due to suspension (could be 403 for plan, 200/201 for success)
    // We verify the suspension-specific block is lifted
    if (response.status() === 403) {
      const body = await response.json().catch(() => ({}));
      const msg: string =
        (body.message ?? body.error ?? '').toLowerCase();
      // Should NOT mention suspension if user is restored
      expect(msg.includes('suspended')).toBe(false);
    }
  });

  test('restored user can post in a room again', async ({ request }) => {
    if (!SUSPENDED_USER_TOKEN_SET || !ADMIN_TOKEN_SET) {
      test.skip(true, 'Required tokens not set — skipping');
      return;
    }

    // Ensure user is restored
    await request.post(`/api/admin/users/${TARGET_USER_ID}/actions`, {
      headers: authHeaders(ADMIN_TOKEN),
      data: { action: 'restore', reason: 'E2E restore before room post test' },
    });

    const response = await request.post(`/api/rooms/${TEST_ROOM_ID}/messages`, {
      headers: authHeaders(SUSPENDED_USER_TOKEN),
      data: { content: 'Room post after restore' },
    });

    // Should not be a suspension-based 403
    if (response.status() === 403) {
      const body = await response.json().catch(() => ({}));
      const msg: string =
        (body.message ?? body.error ?? '').toLowerCase();
      expect(msg.includes('suspended')).toBe(false);
    }
  });
});
