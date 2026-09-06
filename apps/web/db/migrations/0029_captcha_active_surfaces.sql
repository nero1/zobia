-- 0029_captcha_active_surfaces.sql
--
-- CAPTCHA was previously an all-or-nothing switch: `captcha_provider`
-- (recaptcha | turnstile | none) applied uniformly to every form that called
-- verifyCaptcha(). This adds a second, independent x_manifest key so admins
-- can enable/disable CAPTCHA per surface while a provider stays selected.
--
-- Value is a JSON-stringified array of enabled surface keys (same
-- serialization convention as the existing grace_period_features_* keys —
-- see lib/plans/graceFeatures.ts / lib/security/captchaSurfaces.ts for the
-- registry). Effective gate for any surface is:
--   captcha_provider != 'none' AND surface key present in this array.
--
-- Seeded with all 11 known surfaces enabled by default so behavior is
-- unchanged for any surface that already had CAPTCHA wired once a provider
-- is configured.

INSERT INTO x_manifest (key, value, description)
VALUES (
  'captcha_active_surfaces',
  '["login","admin_login","signup","create_blog","create_room","contact_us","blog_comments","create_question","submit_answer","reply_answer_comment","blog_contact_form"]',
  'JSON array of CAPTCHA surface keys with CAPTCHA enabled. Only takes effect when captcha_provider != none. See lib/security/captchaSurfaces.ts.'
)
ON CONFLICT (key) DO NOTHING;
