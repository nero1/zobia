/**
 * app/api/webhooks/paystack/route.ts
 *
 * Legacy webhook URL — delegates to the canonical handler at
 * /api/economy/webhooks/paystack to avoid duplicate processing logic.
 *
 * The canonical handler lives at:
 *   app/api/economy/webhooks/paystack/route.ts
 *
 * Configure your Paystack dashboard to send webhooks to /api/economy/webhooks/paystack.
 * This route is kept for backwards compatibility in case the old URL is still registered.
 */

export { POST } from "@/app/api/economy/webhooks/paystack/route";
