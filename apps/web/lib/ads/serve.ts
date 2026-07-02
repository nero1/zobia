/**
 * lib/ads/serve.ts
 *
 * Ad selection and CPM billing (PRD §17, Pillar 3).
 *
 * Serving picks a random eligible, approved, in-budget creative for a
 * placement — no per-user Redis frequency tracking (keeps Redis calls
 * minimal per project constraint); the client is responsible for
 * lightweight, offline-friendly frequency capping via localStorage
 * (see components/ads/AdSlot.tsx), and the server enforces the hard budget
 * ceiling (a campaign simply stops being selected once its budget is
 * exhausted).
 *
 * Billing draws down `ad_campaigns.spent_credits` (pre-paid budget, funded
 * via lib/ads/repo.ts fundCampaign) rather than writing to coin_ledger per
 * impression — see repo.ts header comment for the rationale.
 */

import Decimal from "decimal.js";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { logger } from "@/lib/logger";
import { getPlanAdsLevel } from "@/lib/ads/limits";
import type { AdSize } from "@/lib/ads/repo";

export interface ServedAd {
  creativeId: string;
  campaignId: string;
  placementKey: string;
  format: string;
  size: AdSize;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  clickUrl: string | null;
  ctaLabel: string | null;
  advertiserName: string;
  advertiserAvatarUrl: string | null;
  thirdPartyTag: string | null;
}

interface CandidateRow {
  creative_id: string;
  campaign_id: string;
  format: string;
  size: AdSize;
  title: string | null;
  body: string | null;
  image_url: string | null;
  click_url: string | null;
  cta_label: string | null;
  third_party_tag: string | null;
  advertiser_name: string | null;
  advertiser_avatar_url: string | null;
}

/**
 * Serve one eligible ad for a placement, or null when no ad should show
 * (ads disabled for this plan, no active/funded campaign, or the native-ads
 * feature flag is off).
 */
export async function serveAd(
  placementKey: string,
  viewerPlan: string | null | undefined
): Promise<ServedAd | null> {
  const level = await getPlanAdsLevel(viewerPlan);
  if (level === "none") return null;

  const { rows } = await db.query<CandidateRow>(
    `SELECT cr.id AS creative_id, cr.campaign_id, cr.format, cr.size, cr.title, cr.body,
            cr.image_url, cr.click_url, cr.cta_label, cr.third_party_tag,
            COALESCE(bp.name, 'Zobia') AS advertiser_name,
            bp.avatar_url AS advertiser_avatar_url
     FROM ad_creatives cr
     JOIN ad_campaigns c ON c.id = cr.campaign_id
     LEFT JOIN business_pages bp ON bp.id = c.business_page_id
     JOIN ad_placements p ON p.key = cr.placement_key
     WHERE cr.placement_key = $1
       AND cr.is_active = true
       AND p.is_active = true
       AND c.status = 'active'
       AND c.moderation_status = 'approved'
       AND c.deleted_at IS NULL
       AND c.spent_credits < c.total_budget_credits
       AND (c.start_at IS NULL OR c.start_at <= NOW())
       AND (c.end_at IS NULL OR c.end_at >= NOW())
       AND (c.target_plans IS NULL OR $2 = ANY (c.target_plans))
     ORDER BY random()
     LIMIT 1`,
    [placementKey, viewerPlan ?? "free"]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    creativeId: row.creative_id,
    campaignId: row.campaign_id,
    placementKey,
    format: row.format,
    size: row.size,
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    clickUrl: row.click_url,
    ctaLabel: row.cta_label,
    advertiserName: row.advertiser_name ?? "Zobia",
    advertiserAvatarUrl: row.advertiser_avatar_url,
    thirdPartyTag: row.third_party_tag,
  };
}

export interface AdEventInput {
  creativeId: string;
  placementKey: string;
  type: "impression" | "click";
  clientEventId?: string;
}

/**
 * Record a batch of impression/click events and bill each impression's CPM
 * against its campaign's pre-paid budget, atomically. Clicks are logged for
 * CTR reporting but are not separately billed (CPM billing, not CPC).
 *
 * Idempotent per (creativeId, type, clientEventId) — a retried beacon flush
 * is a no-op rather than double-billing.
 */
export async function recordAdEvents(events: AdEventInput[], userId: string | null): Promise<void> {
  if (events.length === 0) return;

  for (const event of events.slice(0, 20)) {
    try {
      await db.transaction(async (tx: TransactionClient) => {
        const { rows: creativeRows } = await tx.query<{ campaign_id: string; cpm_credits: string; total_budget_credits: string; spent_credits: string }>(
          `SELECT cr.campaign_id, c.cpm_credits, c.total_budget_credits, c.spent_credits
           FROM ad_creatives cr JOIN ad_campaigns c ON c.id = cr.campaign_id
           WHERE cr.id = $1 FOR UPDATE OF c`,
          [event.creativeId]
        );
        const row = creativeRows[0];
        if (!row) return;

        const cost = event.type === "impression" ? new Decimal(row.cpm_credits).dividedBy(1000) : new Decimal(0);
        const remaining = new Decimal(row.total_budget_credits).minus(row.spent_credits);
        if (event.type === "impression" && remaining.lte(0)) return; // budget exhausted mid-flush

        const { rows: inserted } = await tx.query<{ id: string }>(
          `INSERT INTO ad_events (creative_id, campaign_id, placement_key, user_id, event_type, cost_credits, client_event_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (creative_id, event_type, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [event.creativeId, row.campaign_id, event.placementKey, userId, event.type, cost.toFixed(4), event.clientEventId ?? null]
        );
        if (!inserted[0]) return; // duplicate — already recorded

        if (event.type === "impression") {
          await tx.query(
            `UPDATE ad_campaigns SET spent_credits = spent_credits + $1,
                    status = CASE WHEN spent_credits + $1 >= total_budget_credits THEN 'completed' ELSE status END,
                    updated_at = NOW()
             WHERE id = $2`,
            [cost.toFixed(4), row.campaign_id]
          );
          await tx.query(`UPDATE ad_creatives SET impressions_count = impressions_count + 1 WHERE id = $1`, [event.creativeId]);
        } else {
          await tx.query(`UPDATE ad_creatives SET clicks_count = clicks_count + 1 WHERE id = $1`, [event.creativeId]);
        }

        await tx.query(
          `INSERT INTO ad_campaign_daily_stats (campaign_id, date, impressions, clicks, spend_credits)
           VALUES ($1, CURRENT_DATE, $2, $3, $4)
           ON CONFLICT (campaign_id, date) DO UPDATE
           SET impressions = ad_campaign_daily_stats.impressions + $2,
               clicks = ad_campaign_daily_stats.clicks + $3,
               spend_credits = ad_campaign_daily_stats.spend_credits + $4`,
          [row.campaign_id, event.type === "impression" ? 1 : 0, event.type === "click" ? 1 : 0, cost.toFixed(4)]
        );
      });
    } catch (err) {
      logger.error({ err, event }, "[ads/serve] failed to record ad event");
    }
  }
}
