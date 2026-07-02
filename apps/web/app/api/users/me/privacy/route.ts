export const dynamic = 'force-dynamic';

/**
 * PATCH /api/users/me/privacy
 *
 * Updates the authenticated user's profile privacy settings.
 * Each setting is gated behind plan/role eligibility from x_manifest.
 *
 * Body (all optional):
 *   profile_private         boolean — hide profile from non-friends
 *   profile_hidden_sections string[] — array of section keys to hide
 *   disable_friend_requests boolean — stop receiving friend requests
 *   sitemap_opt_out         boolean — exclude profile from public sitemap (no plan gate)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, handleApiError } from '@/lib/api/errors';
import { db, type SqlParam } from '@/lib/db';
import { getAllowedPlans, isPlanEligible as userEligible } from '@/lib/plans/eligibility';

const VALID_SECTIONS = ['avatar', 'bio', 'rank', 'xp', 'guild', 'seasons', 'badges'];

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const body = await req.json().catch(() => ({})) as {
      profile_private?: boolean;
      profile_hidden_sections?: string[];
      disable_friend_requests?: boolean;
      sitemap_opt_out?: boolean;
      show_online_status?: boolean;
    };

    // Fetch current user plan + prestige
    const { rows: userRows } = await db.query<{ plan: string; prestige_count: number }>(
      `SELECT COALESCE(plan, 'free') AS plan, COALESCE(prestige_count, 0) AS prestige_count
       FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) throw forbidden('User not found');

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSectionsRaw, onlineStatusAllowed] = await Promise.all([
      getAllowedPlans('privacy_can_lock_profile', ['pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_can_hide_sections', ['plus', 'pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_can_disable_friend_requests', ['plus', 'pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_hideable_sections', VALID_SECTIONS),
      getAllowedPlans('privacy_can_show_online_status', ['pro', 'max', 'prestige_1']),
    ]);

    const updates: Record<string, SqlParam> = {};

    if (body.profile_private !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, lockAllowed)) {
        throw forbidden('Your plan does not allow locking your profile');
      }
      updates.profile_private = Boolean(body.profile_private);
    }

    if (body.profile_hidden_sections !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, hideAllowed)) {
        throw forbidden('Your plan does not allow hiding profile sections');
      }
      const sections = Array.isArray(body.profile_hidden_sections)
        ? body.profile_hidden_sections.filter((s) => hideableSectionsRaw.includes(s))
        : [];
      updates.profile_hidden_sections = JSON.stringify(sections);
    }

    if (body.disable_friend_requests !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, noFrAllowed)) {
        throw forbidden('Your plan does not allow disabling friend requests');
      }
      updates.disable_friend_requests = Boolean(body.disable_friend_requests);
    }

    if (body.sitemap_opt_out !== undefined) {
      updates.sitemap_opt_out = Boolean(body.sitemap_opt_out);
    }

    if (body.show_online_status !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, onlineStatusAllowed)) {
        throw forbidden('Your plan does not allow showing your online status');
      }
      updates.show_online_status = Boolean(body.show_online_status);
    }

    if (Object.keys(updates).length === 0) {
      throw badRequest('No valid fields to update');
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = [userId, ...Object.values(updates)];
    await db.query(
      `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $1`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<{
      plan: string;
      prestige_count: number;
      profile_private: boolean;
      profile_hidden_sections: string[];
      disable_friend_requests: boolean;
      sitemap_opt_out: boolean;
      show_online_status: boolean;
    }>(
      `SELECT COALESCE(plan, 'free') AS plan,
              COALESCE(prestige_count, 0) AS prestige_count,
              COALESCE(profile_private, false) AS profile_private,
              COALESCE(profile_hidden_sections, '[]'::jsonb) AS profile_hidden_sections,
              COALESCE(disable_friend_requests, false) AS disable_friend_requests,
              COALESCE(sitemap_opt_out, false) AS sitemap_opt_out,
              COALESCE(show_online_status, false) AS show_online_status
       FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSections, onlineStatusAllowed] = await Promise.all([
      getAllowedPlans('privacy_can_lock_profile', ['pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_can_hide_sections', ['plus', 'pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_can_disable_friend_requests', ['plus', 'pro', 'max', 'prestige_1']),
      getAllowedPlans('privacy_hideable_sections', VALID_SECTIONS),
      getAllowedPlans('privacy_can_show_online_status', ['pro', 'max', 'prestige_1']),
    ]);

    return NextResponse.json({
      settings: {
        profile_private: user.profile_private,
        profile_hidden_sections: Array.isArray(user.profile_hidden_sections)
          ? user.profile_hidden_sections
          : [],
        disable_friend_requests: user.disable_friend_requests,
        sitemap_opt_out: user.sitemap_opt_out,
        show_online_status: user.show_online_status,
      },
      capabilities: {
        canLockProfile: userEligible(user.plan, user.prestige_count, lockAllowed),
        canHideSections: userEligible(user.plan, user.prestige_count, hideAllowed),
        canDisableFriendRequests: userEligible(user.plan, user.prestige_count, noFrAllowed),
        canShowOnlineStatus: userEligible(user.plan, user.prestige_count, onlineStatusAllowed),
        hideableSections,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
