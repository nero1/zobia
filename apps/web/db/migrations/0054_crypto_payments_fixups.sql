-- 0054_crypto_payments_fixups.sql
--
-- Follow-up fixes for 0053_crypto_payments.sql, found while wiring the
-- crypto checkout frontend and server-side context-settings enforcement:
--
--   1. `payments_provider_check` still only allowed
--      ('paystack', 'dodopayments', 'google_play') — every `lib/payments/crypto`
--      insert with provider = 'crypto' would have violated this constraint at
--      runtime. Also add 'free' for the new payment_context_settings
--      "is_free" grant path (lib/payments/contextSettings.ts
--      enforcePaymentContext), which records a zero-value payment row
--      instead of calling any provider.
-- ---------------------------------------------------------------------------

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE payments
  ADD CONSTRAINT payments_provider_check
  CHECK (provider = ANY (ARRAY['paystack'::text, 'dodopayments'::text, 'google_play'::text, 'crypto'::text, 'free'::text]));
