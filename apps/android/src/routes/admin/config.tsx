/**
 * apps/android/src/routes/admin/config.tsx
 *
 * Platform Configuration — mirrors apps/web/app/(admin)/admin/config/page.tsx:
 * grouped x_manifest settings (Auth, CAPTCHA, GIF, PWA, Payments, Economy,
 * Fraud Detection, AdMob, Limits, AI Moderation, Guild Wars, Messaging,
 * Moments, Answers, Physical Goods, Grace Periods & Save Slots, Business
 * Accounts, Miscellaneous) per PRD §20. Booleans use AdminToggle, enums use
 * a native <select>, numbers/strings use an inline edit field, multiselects
 * use a checkbox list.
 *
 * GET  /api/admin/config           → RawManifestEntry[] (auto-unwrapped by apiClient)
 * PUT  /api/admin/config/:key      { value: string } → { key, value }
 *
 * feature_* keys are intentionally excluded here (except feature_admob_ads /
 * feature_rewarded_ads, which live in the AdMob group) — every other
 * feature_* flag is managed on the dedicated Feature Flags page.
 */

import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminErrorState, AdminToggle, adminInputClass } from '@/components/admin/AdminUI';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConfigValueType = 'boolean' | 'string' | 'number' | 'select' | 'multiselect';

interface ConfigOption {
  value: string;
  labelDefault: string;
}

interface ConfigMeta {
  labelKey: string;
  labelDefault: string;
  descKey: string;
  descDefault: string;
  type: ConfigValueType;
  group: string;
  options?: ConfigOption[];
}

interface RawManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

interface ConfigItem {
  key: string;
  value: boolean | string | number | string[];
  meta: ConfigMeta;
}

type GroupedConfig = Record<string, ConfigItem[]>;

// ---------------------------------------------------------------------------
// Metadata — mirrors web's CONFIG_META 1:1 (label/description/type/group).
// ---------------------------------------------------------------------------

const GRACE_FEATURE_OPTIONS: ConfigOption[] = [
  { value: 'saved_games', labelDefault: 'Saved Games (Save Slots)' },
  { value: 'galleries', labelDefault: 'Image Galleries' },
];

function meta(
  key: string,
  labelDefault: string,
  descDefault: string,
  type: ConfigValueType,
  group: string,
  options?: ConfigOption[],
): [string, ConfigMeta] {
  return [
    key,
    {
      labelKey: `admin.config.meta.${key}.label`,
      labelDefault,
      descKey: `admin.config.meta.${key}.desc`,
      descDefault,
      type,
      group,
      options,
    },
  ];
}

const CONFIG_META: Record<string, ConfigMeta> = Object.fromEntries([
  // Auth
  meta('auth_google_enabled', 'Google OAuth', 'Allow users to sign in with their Google account.', 'boolean', 'Auth'),
  meta('auth_telegram_enabled', 'Telegram Login', 'Allow users to sign in via Telegram Login widget.', 'boolean', 'Auth'),
  meta('auth_2fa_enabled', 'Two-Factor Authentication (2FA)', 'Allow users to enable TOTP-based 2FA on their accounts.', 'boolean', 'Auth'),
  meta('auth_2fa_required_for_mods', 'Require 2FA for Moderators', 'Block moderator logins until they set up 2FA on their account.', 'boolean', 'Auth'),
  meta('feature_pin_auth', 'PIN Authentication', 'Allow users to set a numeric PIN for quick app unlock.', 'boolean', 'Auth'),

  // CAPTCHA
  meta('captcha_provider', 'CAPTCHA Provider', 'CAPTCHA service used on registration, login, and sensitive forms.', 'select', 'CAPTCHA', [
    { value: 'recaptcha', labelDefault: 'Google reCAPTCHA v3' },
    { value: 'turnstile', labelDefault: 'Cloudflare Turnstile' },
    { value: 'none', labelDefault: 'None (disable CAPTCHA)' },
  ]),

  // GIF
  meta('gif_provider', 'GIF Search Provider', 'Third-party service used to power the GIF picker in chat.', 'select', 'GIF', [
    { value: 'giphy', labelDefault: 'Giphy' },
    { value: 'tenor', labelDefault: 'Tenor (Google)' },
  ]),

  // PWA
  meta('pwa_web_enabled', 'PWA — Web Browser', 'Enable Progressive Web App install prompt in desktop/mobile browsers.', 'boolean', 'PWA'),
  meta('pwa_android_enabled', 'PWA — Android', 'Enable PWA install for Android home screen.', 'boolean', 'PWA'),
  meta('pwa_ios_enabled', 'PWA — iOS', 'Enable PWA install for iOS home screen (Safari Add to Home Screen).', 'boolean', 'PWA'),

  // Payments
  meta('payment_primary_provider', 'Primary Payment Provider', 'The default gateway used for deposits and payouts.', 'select', 'Payments', [
    { value: 'paystack', labelDefault: 'Paystack' },
    { value: 'dodopayments', labelDefault: 'Dodo Payments' },
    { value: 'none', labelDefault: 'None (payments disabled)' },
  ]),
  meta('payment_paystack_enabled', 'Paystack Enabled', 'Allow Paystack as a payment method.', 'boolean', 'Payments'),
  meta('payment_dodopayments_enabled', 'Dodo Payments Enabled', 'Allow Dodo Payments as a payment method.', 'boolean', 'Payments'),

  // Economy
  meta('currency_soft_name_singular', 'Soft Currency Name (Singular)', 'Display name for one unit of the soft (earned) currency. Default: Credit', 'string', 'Economy'),
  meta('currency_soft_name_plural', 'Soft Currency Name (Plural)', 'Display name for multiple units of the soft (earned) currency. Default: Credits', 'string', 'Economy'),
  meta('currency_premium_name_singular', 'Premium Currency Name (Singular)', 'Display name for one unit of the premium (purchased) currency. Default: Star', 'string', 'Economy'),
  meta('currency_premium_name_plural', 'Premium Currency Name (Plural)', 'Display name for multiple units of the premium (purchased) currency. Default: Stars', 'string', 'Economy'),
  meta('coin_to_cash_rate', 'Credit-to-Cash Rate', 'Number of Credits equivalent to ₦1 (e.g. 100 means 100 Credits = ₦1).', 'number', 'Economy'),
  meta('payout_threshold_kobo', 'Minimum Payout (kobo)', 'Minimum creator payout amount in kobo. 100 kobo = ₦1.', 'number', 'Economy'),
  meta('payout_large_approval_kobo', 'Large Payout Approval Threshold (kobo)', 'Withdrawals above this kobo amount require manual admin approval.', 'number', 'Economy'),
  meta('season_pass_price_coins', 'Season Pass Price (Credits)', 'Default price of a Season Pass in Credits.', 'number', 'Economy'),
  meta('vip_room_min_price_kobo', 'VIP Room Min Price (kobo)', 'Minimum subscription price a creator can set for a VIP Room.', 'number', 'Economy'),
  meta('vip_room_max_price_kobo', 'VIP Room Max Price (kobo)', 'Maximum subscription price a creator can set for a VIP Room.', 'number', 'Economy'),

  // Fraud Detection
  meta('fraud_gift_window_days', 'Gift Fraud Window (days)', "Look-back window for new-account gift-inflow fraud check. Default: 7.", 'number', 'Fraud Detection'),
  meta('fraud_inflow_threshold_coins', 'Gift Inflow Threshold (coins)', 'Minimum coins received from new accounts within the fraud window to trigger a flag. Default: 5000.', 'number', 'Fraud Detection'),
  meta('fraud_new_account_age_days', 'New Account Age (days)', "Age (days) below which a gift sender is treated as a 'new account' for fraud purposes. Default: 7.", 'number', 'Fraud Detection'),
  meta('fraud_max_payouts_per_day', 'Max Payout Requests per Day', 'Maximum payout requests per creator per 24h before a velocity fraud flag fires. Default: 3.', 'number', 'Fraud Detection'),

  // Limits
  meta('minimum_age', 'Minimum Registration Age', 'Minimum age (in years) required to create an account.', 'number', 'Limits'),

  // AdMob
  meta('feature_admob_ads', 'AdMob Ads', 'Show AdMob banner/interstitial ads to free-tier users.', 'boolean', 'AdMob'),
  meta('feature_rewarded_ads', 'Rewarded Ads', 'Allow free-tier users to earn Credits by watching rewarded ads.', 'boolean', 'AdMob'),

  // AI Moderation
  meta('ai_moderation_auto_action_threshold', 'Auto-Action Threshold', 'Confidence score (0.0–1.0) above which the AI automatically removes content / suspends users. Default: 0.9', 'number', 'AI Moderation'),
  meta('ai_moderation_community_threshold', 'Community Review Threshold', 'Confidence score (0.0–1.0) above which a report is sent to Community Notes for crowd review. Below this = manual queue. Default: 0.7', 'number', 'AI Moderation'),
  meta('ai_moderation_system_prompt', 'AI System Prompt Override', 'Custom system prompt for AI classification. Leave empty to use the built-in default prompt.', 'string', 'AI Moderation'),

  // Guild Wars
  meta('feature_war_event_active', 'Platform War Event Active', 'Activates a platform-wide War Event. Reduces war cooldown to the configured hours below.', 'boolean', 'Guild Wars'),
  meta('war_event_cooldown_hours', 'War Event Cooldown (hours)', 'Guild war cooldown during an active War Event. Default is 48. Normal cooldown is 72 hours.', 'number', 'Guild Wars'),

  // Messaging
  meta('feature_pidgin_autocomplete', 'Pidgin Autocomplete', 'When enabled, users can turn on Pidgin word suggestions in the message composer.', 'boolean', 'Messaging'),
  meta('announcement_modal_display_mode', 'Announcement Modal Display Mode', "How modals are rotated per user: 'serial' shows them in order, 'random' picks randomly.", 'select', 'Messaging', [
    { value: 'serial', labelDefault: 'Serial (in order)' },
    { value: 'random', labelDefault: 'Random' },
  ]),
  meta('announcement_banner_mode', 'Announcement Banner Display Mode', "How banners are rotated per user: 'serial' shows them in order, 'random' picks randomly.", 'select', 'Messaging', [
    { value: 'serial', labelDefault: 'Serial (in order)' },
    { value: 'random', labelDefault: 'Random' },
  ]),

  // Moments
  meta('feature_moments', 'Enable Moments', 'Master toggle for Zobia Moments (the /moments feed and the in-Room ⚡ toggle). When off, all Moments endpoints return 503.', 'boolean', 'Moments'),
  meta('moments_min_level', 'Minimum Level to Post', 'Minimum account level (main rank number, 1 = Beginner, 2 = Rookie, …) required to share a Moment. Default: 2.', 'number', 'Moments'),
  meta('moments_cost_credits', 'Cost in Credits', 'Credits charged to post a Moment. Set to 0 to disable paying with Credits. Default: 100.', 'number', 'Moments'),
  meta('moments_cost_stars', 'Cost in Stars', 'Stars charged to post a Moment. Set to 0 to disable paying with Stars. Setting both costs to 0 makes Moments free. Default: 1.', 'number', 'Moments'),

  // Answers (Mini Forum / Q&A)
  meta('feature_forum', 'Enable Answers', 'Master toggle for the mini forum (Q&A). When off, all /answers endpoints return 503.', 'boolean', 'Answers'),
  meta('forum_min_level_to_post', 'Minimum Level to Post', 'Minimum account level required to post a question. Default: 2.', 'number', 'Answers'),
  meta('forum_min_level_to_comment', 'Minimum Level to Comment (Free)', 'Minimum account level required to answer/comment without paying. Below this level, users can still comment by spending credits. Default: 1.', 'number', 'Answers'),
  meta('forum_comment_bypass_cost_credits', 'Comment Bypass Cost (Credits)', 'Credits charged to comment when below the comment level gate. Default: 1.', 'number', 'Answers'),
  meta('forum_reward_xp_per_question', 'XP per Question', 'XP awarded for posting a question. Default: 10.', 'number', 'Answers'),
  meta('forum_reward_credits_per_question', 'Credits per Question', 'Credits awarded for posting a question. Default: 0.', 'number', 'Answers'),
  meta('forum_reward_xp_per_answer', 'XP per Answer', 'XP awarded for posting an answer. Default: 5.', 'number', 'Answers'),
  meta('forum_reward_credits_per_answer', 'Credits per Answer', 'Credits awarded for posting an answer. Default: 0.', 'number', 'Answers'),
  meta('forum_reward_xp_per_upvote', 'XP per Upvote Received', "XP awarded to a content author each time their question/answer receives a net new upvote. Default: 1.", 'number', 'Answers'),
  meta('forum_reward_credits_per_upvote', 'Credits per Upvote Received', "Credits awarded to a content author each time their question/answer receives a net new upvote. Default: 0.", 'number', 'Answers'),
  meta('forum_reward_xp_best_answer', 'XP for Best Answer', "XP awarded to an answer's author when the question author marks it best. Default: 25.", 'number', 'Answers'),
  meta('forum_reward_credits_best_answer', 'Credits for Best Answer', "Credits awarded to an answer's author when the question author marks it best. Default: 10.", 'number', 'Answers'),
  meta('forum_daily_reward_cap_credits', 'Daily Reward Cap (Credits)', 'Maximum total forum-sourced credit rewards a single user can earn per rolling 24h — an anti-farming ceiling. Default: 50.', 'number', 'Answers'),
  meta('forum_auto_moderation_enabled', 'Auto-Moderation', 'Run profanity and duplicate-post filters on new questions and answers automatically.', 'boolean', 'Answers'),

  // Physical Goods
  meta('physical_goods_enabled', 'Allow Physical Product Sales', 'Master toggle — enables physical goods in creator merch stores.', 'boolean', 'Physical Goods'),
  meta('physical_goods_fulfillment_manual', 'Manual Fulfillment', 'Allow creators to fulfill physical orders manually (ship-it-yourself with optional tracking).', 'boolean', 'Physical Goods'),
  meta('physical_goods_fulfillment_partner', 'Partner Integration (Coming Soon)', "Enable the partner fulfillment option. UI shows 'Coming Soon' — only manual fulfillment is processed.", 'boolean', 'Physical Goods'),

  // Floating Notifications
  meta('floating_notifications_enabled', 'Enable Floating Notifications', 'Show floating reward notifications (+5 XP, +25 Credits, etc.) when users earn currency. Applies to all platforms.', 'boolean', 'Floating Notifications'),
  meta('floating_notifications_xp_threshold', 'XP Confetti Threshold', 'Single XP award must reach this amount to also trigger a confetti celebration. Default: 100.', 'number', 'Floating Notifications'),
  meta('floating_notifications_credits_threshold', 'Credits Confetti Threshold', 'Single Credit award must reach this amount to also trigger a confetti celebration. Default: 50.', 'number', 'Floating Notifications'),
  meta('floating_notifications_stars_threshold', 'Stars Confetti Threshold', 'Single Star award must reach this amount to also trigger a confetti celebration. Default: 10.', 'number', 'Floating Notifications'),

  // Grace Periods & Save Slots
  meta('save_slots_free', 'Save Slots — Free', 'Number of save slots (paused in-progress games) available to Free plan users.', 'number', 'Grace Periods & Save Slots'),
  meta('save_slots_plus', 'Save Slots — Plus', 'Number of save slots available to Plus plan users.', 'number', 'Grace Periods & Save Slots'),
  meta('save_slots_pro', 'Save Slots — Pro', 'Number of save slots available to Pro plan users.', 'number', 'Grace Periods & Save Slots'),
  meta('save_slots_max', 'Save Slots — Max', 'Number of save slots available to Max plan users.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_plus', 'Grace Period (days) — Plus', 'Days after a Plus subscription lapses before grace-gated data (e.g. saved games) is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_pro', 'Grace Period (days) — Pro', 'Days after a Pro subscription lapses before grace-gated data is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_max', 'Grace Period (days) — Max', 'Days after a Max subscription lapses before grace-gated data is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_business_starter', 'Grace Period (days) — Business Starter', 'Days after a Business Starter subscription lapses before grace-gated data is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_business_growth', 'Grace Period (days) — Business Growth', 'Days after a Business Growth subscription lapses before grace-gated data is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_days_business_enterprise', 'Grace Period (days) — Business Enterprise', 'Days after a Business Enterprise subscription lapses before grace-gated data is purged.', 'number', 'Grace Periods & Save Slots'),
  meta('grace_period_features_plus', 'Preserved During Grace — Plus', 'Which grace-gated features are kept (not purged) during the Plus grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),
  meta('grace_period_features_pro', 'Preserved During Grace — Pro', 'Which grace-gated features are kept (not purged) during the Pro grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),
  meta('grace_period_features_max', 'Preserved During Grace — Max', 'Which grace-gated features are kept (not purged) during the Max grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),
  meta('grace_period_features_business_starter', 'Preserved During Grace — Business Starter', 'Which grace-gated features are kept during the Business Starter grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),
  meta('grace_period_features_business_growth', 'Preserved During Grace — Business Growth', 'Which grace-gated features are kept during the Business Growth grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),
  meta('grace_period_features_business_enterprise', 'Preserved During Grace — Business Enterprise', 'Which grace-gated features are kept during the Business Enterprise grace period.', 'multiselect', 'Grace Periods & Save Slots', GRACE_FEATURE_OPTIONS),

  // Business Accounts
  meta('business_starter_price_kobo', 'Business Starter Price (kobo)', 'Monthly price of the Business Starter tier, in kobo (default 500000 = ₦5,000).', 'number', 'Business Accounts'),
  meta('business_growth_price_kobo', 'Business Growth Price (kobo)', 'Monthly price of the Business Growth tier, in kobo (default 1500000 = ₦15,000).', 'number', 'Business Accounts'),
  meta('business_enterprise_price_kobo', 'Business Enterprise Price (kobo)', 'Monthly price of the Business Enterprise tier, in kobo (default 5000000 = ₦50,000).', 'number', 'Business Accounts'),
  meta('business_page_limit_starter', 'Business Page Limit — Starter', 'Max Business Pages a Business Starter account may create.', 'number', 'Business Accounts'),
  meta('business_page_limit_growth', 'Business Page Limit — Growth', 'Max Business Pages a Business Growth account may create.', 'number', 'Business Accounts'),
  meta('business_page_limit_enterprise', 'Business Page Limit — Enterprise', 'Max Business Pages a Business Enterprise account may create.', 'number', 'Business Accounts'),
  meta('sponsored_quest_moderation_mode', 'Sponsored Quest Moderation Mode', 'How business-submitted Sponsored Quests are moderated before going live.', 'select', 'Business Accounts', [
    { value: 'manual', labelDefault: 'Manual (admin approval queue)' },
    { value: 'ai', labelDefault: 'AI moderation (with manual fallback)' },
  ]),
  meta('sponsored_quest_ai_auto_approve_threshold', 'Sponsored Quest AI Auto-Approve Threshold', 'AI moderation confidence (0-1) at or above which a business-submitted Sponsored Quest is auto-approved when moderation mode is "ai".', 'number', 'Business Accounts'),
  meta('business_downgrade_grace_days', 'Business Downgrade Grace Period (days)', 'Days after a business account tier downgrade before extra pages are deactivated and running sponsored quests are stopped.', 'number', 'Business Accounts'),

  // Miscellaneous
  meta('deep_link_base_url', 'Deep Link Base URL', 'Base URL used when generating deep links (e.g. https://zobia.app).', 'string', 'Miscellaneous'),
]);

const GROUP_ORDER = [
  'Auth', 'CAPTCHA', 'GIF', 'PWA', 'Floating Notifications', 'Payments', 'Economy',
  'Fraud Detection', 'AdMob', 'Limits', 'AI Moderation', 'Guild Wars', 'Messaging',
  'Moments', 'Answers', 'Physical Goods', 'Grace Periods & Save Slots', 'Business Accounts',
  'Miscellaneous',
];

const GROUP_LABEL: Record<string, string> = {
  Auth: 'admin.config.group.auth',
  CAPTCHA: 'admin.config.group.captcha',
  GIF: 'admin.config.group.gif',
  PWA: 'admin.config.group.pwa',
  'Floating Notifications': 'admin.floatingNotifications.title',
  Payments: 'admin.config.group.payments',
  Economy: 'admin.config.group.economy',
  'Fraud Detection': 'admin.config.group.fraudDetection',
  AdMob: 'admin.config.group.admob',
  Limits: 'admin.config.group.limits',
  'AI Moderation': 'admin.config.group.aiModeration',
  'Guild Wars': 'admin.config.group.guildWars',
  Messaging: 'admin.config.group.messaging',
  Moments: 'admin.config.group.moments',
  Answers: 'admin.config.group.answers',
  'Physical Goods': 'admin.config.group.physicalGoods',
  'Grace Periods & Save Slots': 'admin.config.group.gracePeriods',
  'Business Accounts': 'admin.config.group.businessAccounts',
  Miscellaneous: 'admin.config.group.miscellaneous',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toConfigItem(entry: RawManifestEntry): ConfigItem | null {
  // feature_* keys (other than the two AdMob ones) live on the Feature Flags page.
  if (entry.key.startsWith('feature_') && entry.key !== 'feature_admob_ads' && entry.key !== 'feature_rewarded_ads') {
    return null;
  }

  const m = CONFIG_META[entry.key];
  if (m) {
    let value: boolean | string | number | string[];
    if (m.type === 'boolean') value = entry.value === 'true';
    else if (m.type === 'number') value = parseInt(entry.value, 10) || 0;
    else if (m.type === 'multiselect') {
      try {
        const parsed = JSON.parse(entry.value) as unknown;
        value = Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        value = [];
      }
    } else value = entry.value;
    return { key: entry.key, value, meta: m };
  }

  // Unknown key — fall back to an editable string in Miscellaneous.
  return {
    key: entry.key,
    value: entry.value,
    meta: {
      labelKey: `admin.config.meta.${entry.key}.label`,
      labelDefault: entry.key,
      descKey: `admin.config.meta.${entry.key}.desc`,
      descDefault: entry.description ?? '',
      type: 'string',
      group: 'Miscellaneous',
    },
  };
}

async function fetchConfig(): Promise<GroupedConfig> {
  const { data } = await apiClient.get<RawManifestEntry[]>('/admin/config');
  const items = (data ?? []).map(toConfigItem).filter((i): i is ConfigItem => i !== null);
  const grouped: GroupedConfig = {};
  for (const item of items) {
    const g = item.meta.group || 'Miscellaneous';
    (grouped[g] ??= []).push(item);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Config row
// ---------------------------------------------------------------------------

function ConfigRow({
  item,
  saving,
  onSave,
}: {
  item: ConfigItem;
  saving: boolean;
  onSave: (key: string, value: boolean | string | number | string[]) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Array.isArray(item.value) ? '' : item.value));

  return (
    <div className="border-b border-neutral-100 py-3.5 last:border-0">
      <p className="font-mono text-[10px] text-neutral-400">{item.key}</p>
      <p className="text-sm font-semibold text-neutral-900">{t(item.meta.labelKey, item.meta.labelDefault)}</p>
      <p className="mb-2.5 text-xs text-neutral-500">{t(item.meta.descKey, item.meta.descDefault)}</p>

      {item.meta.type === 'boolean' && (
        <AdminToggle checked={item.value as boolean} onChange={(v) => onSave(item.key, v)} disabled={saving} />
      )}

      {item.meta.type === 'select' && (
        <select
          value={String(item.value)}
          disabled={saving}
          onChange={(e) => onSave(item.key, e.target.value)}
          className={adminInputClass}
        >
          {item.meta.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelDefault}
            </option>
          ))}
        </select>
      )}

      {item.meta.type === 'multiselect' && (
        <div className="flex flex-col gap-1.5">
          {item.meta.options?.map((opt) => {
            const list = Array.isArray(item.value) ? item.value : [];
            const checked = list.includes(opt.value);
            return (
              <label key={opt.value} className="flex items-center gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving}
                  onChange={(e) => {
                    const next = e.target.checked ? [...list, opt.value] : list.filter((v) => v !== opt.value);
                    onSave(item.key, next);
                  }}
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                {opt.labelDefault}
              </label>
            );
          })}
        </div>
      )}

      {(item.meta.type === 'string' || item.meta.type === 'number') &&
        (editing ? (
          <div className="flex items-center gap-2">
            <input
              type={item.meta.type === 'number' ? 'number' : 'text'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className={adminInputClass}
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                onSave(item.key, item.meta.type === 'number' ? Number(draft) : draft);
                setEditing(false);
              }}
              className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? '…' : t('common.confirm', 'Save')}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(String(item.value)); }}
              className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-mono text-xs text-neutral-700">{String(item.value)}</span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700"
            >
              {t('admin.config.edit', 'Edit')}
            </button>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group card
// ---------------------------------------------------------------------------

function ConfigGroupCard({
  group,
  items,
  savingKey,
  onSave,
}: {
  group: string;
  items: ConfigItem[];
  savingKey: string | null;
  onSave: (key: string, value: boolean | string | number | string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3.5 text-left">
        <div>
          <p className="text-sm font-semibold text-neutral-900">{t(GROUP_LABEL[group] ?? group, group)}</p>
          <p className="text-[11px] text-neutral-500">{t('admin.config.settingsCount', '{{count}} settings', { count: items.length })}</p>
        </div>
        <span className="text-neutral-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-neutral-100 px-4">
          {items.map((item) => (
            <ConfigRow key={item.key} item={item} saving={savingKey === item.key} onSave={onSave} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminConfigPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'config'], queryFn: fetchConfig });

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | string | number | string[] }) => {
      const stringValue = Array.isArray(value) ? JSON.stringify(value) : String(value);
      return apiClient.put(`/admin/config/${key}`, { value: stringValue });
    },
    onSuccess: (_res, { key }) => {
      showToast(t('admin.config.saved', '{{key}} saved', { key }));
      qc.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: () => showToast(t('admin.config.saveFailed', 'Failed to save'), 'error'),
  });

  const sortedGroups = useMemo(() => {
    if (!data) return [];
    return GROUP_ORDER.filter((g) => data[g]?.length).concat(Object.keys(data).filter((g) => !GROUP_ORDER.includes(g)));
  }, [data]);

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.config', 'Platform Configuration')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      {status === 'pending' && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4">
              <div className="h-4 w-32 rounded bg-neutral-200" />
              <div className="mt-3 h-3 w-full rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-3">
          {sortedGroups.map((group) => (
            <ConfigGroupCard
              key={group}
              group={group}
              items={data[group] ?? []}
              savingKey={saveMutation.isPending ? (saveMutation.variables?.key ?? null) : null}
              onSave={(key, value) => saveMutation.mutate({ key, value })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/config')({
  component: AdminConfigPage,
});
