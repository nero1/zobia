export const dynamic = 'force-dynamic';

/**
 * app/api/webhooks/dodopayments/route.ts
 *
 * Legacy webhook URL — delegates to the canonical handler at
 * /api/economy/webhooks/dodopayments to avoid duplicate processing logic.
 *
 * Configure your DodoPayments dashboard to send webhooks to
 * /api/economy/webhooks/dodopayments. This route is kept for backwards
 * compatibility in case the old URL is still registered.
 */

export { POST } from "@/app/api/economy/webhooks/dodopayments/route";
