export const dynamic = 'force-dynamic';

/**
 * app/api/admin/overview/route.ts
 *
 * Admin dashboard overview endpoint.
 *
 * GET /api/admin/overview
 *   Admin-only (is_admin verified from DATABASE, not just JWT).
 *
 *   Returns:
 *     - DAU / WAU / MAU (daily / weekly / monthly active users)
 *     - New registrations today and this week
 *     - Revenue summary today / week / month
 *     - Active rooms count
 *     - Active guilds count
 *     - Moderation queue depth (pending reports)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewStats {
  active_users: {
    dau: number;
    wau: number;
    mau: number;
  };
  registrations: {
    today: number;
    this_week: number;
  };
  revenue: {
    today: number;
    this_week: number;
    this_month: number;
    currency: string;
  };
  rooms: {
    active: number;
  };
  guilds: {
    active: number;
  };
  guild_wars: {
    active: number;
  };
  moderation: {
    pending_reports: number;
  };
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute multiple count/sum queries in parallel and return the results.
 * Returns 0 for any query that fails (best-effort – don't crash the overview).
 *
 * @param queries - Array of { label, sql, params } objects
 * @returns Map of label → numeric value
 */
async function runCountQueries(
  queries: Array<{ label: string; sql: string; params?: (string | number)[] }>
): Promise<Map<string, number>> {
  const results = await Promise.allSettled(
    queries.map(({ sql, params }) =>
      db.query<{ value: string }>(sql, params)
    )
  );

  const map = new Map<string, number>();
  queries.forEach(({ label }, i) => {
    const result = results[i];
    if (result.status === "fulfilled") {
      const raw = result.value.rows[0]?.value ?? "0";
      map.set(label, parseFloat(raw) || 0);
    } else {
      console.error(`[admin:overview] Query '${label}' failed:`, result.reason);
      map.set(label, 0);
    }
  });

  return map;
}

// ---------------------------------------------------------------------------
// GET /api/admin/overview
// ---------------------------------------------------------------------------

/**
 * Return the admin dashboard overview statistics.
 *
 * All queries are run in parallel for performance.
 * Individual query failures return 0 rather than failing the whole request.
 *
 * @returns JSON OverviewStats
 */
export const GET = withAdminAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const stats = await runCountQueries([
      // Active users (last_seen within window)
      {
        label: "dau",
        sql: `SELECT COUNT(*)::text AS value FROM users
              WHERE last_seen_at >= NOW() - INTERVAL '1 day'
                AND deleted_at IS NULL`,
      },
      {
        label: "wau",
        sql: `SELECT COUNT(*)::text AS value FROM users
              WHERE last_seen_at >= NOW() - INTERVAL '7 days'
                AND deleted_at IS NULL`,
      },
      {
        label: "mau",
        sql: `SELECT COUNT(*)::text AS value FROM users
              WHERE last_seen_at >= NOW() - INTERVAL '30 days'
                AND deleted_at IS NULL`,
      },

      // Registrations
      {
        label: "registrations_today",
        sql: `SELECT COUNT(*)::text AS value FROM users
              WHERE created_at >= CURRENT_DATE
                AND deleted_at IS NULL`,
      },
      {
        label: "registrations_week",
        sql: `SELECT COUNT(*)::text AS value FROM users
              WHERE created_at >= NOW() - INTERVAL '7 days'
                AND deleted_at IS NULL`,
      },

      // Revenue (sum of successful payment amounts)
      {
        label: "revenue_today",
        sql: `SELECT COALESCE(SUM(amount), 0)::text AS value
              FROM payments
              WHERE status = 'success'
                AND created_at >= CURRENT_DATE`,
      },
      {
        label: "revenue_week",
        sql: `SELECT COALESCE(SUM(amount), 0)::text AS value
              FROM payments
              WHERE status = 'success'
                AND created_at >= NOW() - INTERVAL '7 days'`,
      },
      {
        label: "revenue_month",
        sql: `SELECT COALESCE(SUM(amount), 0)::text AS value
              FROM payments
              WHERE status = 'success'
                AND created_at >= NOW() - INTERVAL '30 days'`,
      },

      // Rooms
      {
        label: "active_rooms",
        sql: `SELECT COUNT(*)::text AS value FROM rooms
              WHERE is_active = true AND deleted_at IS NULL`,
      },

      // Guilds
      {
        label: "active_guilds",
        sql: `SELECT COUNT(*)::text AS value FROM guilds
              WHERE is_active = true AND deleted_at IS NULL`,
      },

      // Active guild wars
      {
        label: "active_guild_wars",
        sql: `SELECT COUNT(*)::text AS value FROM guild_wars
              WHERE status IN ('active', 'final_hour')`,
      },

      // Moderation queue
      {
        label: "pending_reports",
        sql: `SELECT COUNT(*)::text AS value FROM user_reports
              WHERE status = 'pending'`,
      },
    ]);

    const overview: OverviewStats = {
      active_users: {
        dau: stats.get("dau") ?? 0,
        wau: stats.get("wau") ?? 0,
        mau: stats.get("mau") ?? 0,
      },
      registrations: {
        today: stats.get("registrations_today") ?? 0,
        this_week: stats.get("registrations_week") ?? 0,
      },
      revenue: {
        today: stats.get("revenue_today") ?? 0,
        this_week: stats.get("revenue_week") ?? 0,
        this_month: stats.get("revenue_month") ?? 0,
        currency: "NGN",
      },
      rooms: {
        active: stats.get("active_rooms") ?? 0,
      },
      guilds: {
        active: stats.get("active_guilds") ?? 0,
      },
      guild_wars: {
        active: stats.get("active_guild_wars") ?? 0,
      },
      moderation: {
        pending_reports: stats.get("pending_reports") ?? 0,
      },
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json(overview, {
      status: 200,
      headers: {
        // Short cache – admin dashboards should be near-real-time
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
