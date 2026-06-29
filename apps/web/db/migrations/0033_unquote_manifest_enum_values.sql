-- Migration 0033: Strip JSON quotes from x_manifest enum/string values
--
-- Several x_manifest rows were seeded with their values JSON-encoded — e.g.
-- captcha_provider was stored as the literal `"none"` (quotes included) rather
-- than the bare `none`. Application code compares these against bare strings
-- (`value === "turnstile"`), so a quoted value never matches and silently falls
-- through to a fallback provider. In production this made Google login fail with
-- a spurious "CAPTCHA required" error and made the admin "captcha off" toggle a
-- no-op, because the stored `"none"` never matched the `none` branch.
--
-- The application now also unquotes on read (defence in depth), but this
-- migration normalises the already-stored rows so the admin panel displays the
-- bare value and the persisted state is canonical.
--
-- Idempotent: only rewrites rows whose value is wrapped in double quotes, and
-- re-running is a no-op once values are bare.

UPDATE x_manifest
SET value = substring(value FROM 2 FOR length(value) - 2)
WHERE value LIKE '"%"'
  AND length(value) >= 2;
