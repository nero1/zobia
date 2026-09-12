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
 *   nemesis_opt_out         boolean — turn the Nemesis system off entirely (no plan gate)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, handleApiError } from '@/lib/api/errors';
import { db, type SqlParam } from '@/lib/db';
import { getAllowedPlans, isPlanEligible as userEligible, allEligibilityOptionsExcept } from '@/lib/plans/eligibility';

const VALID_SECTIONS = ['avatar', 'bio', 'rank', 'xp', 'guild', 'seasons', 'badges', 'activities'];

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const body = await req.json().catch(() => ({})) as {
      profile_private?: boolean;
      profile_hidden_sections?: string[];
      disable_friend_requests?: boolean;
      sitemap_opt_out?: boolean;
      show_online_status?: boolean;
      group_invite_privacy?: 'anybody' | 'friends' | 'nobody';
      nemesis_opt_out?: boolean;
    };

    // Fetch current user plan + prestige + role + business tier (business
    // tier and role are additional eligibility dimensions alongside plan/
    // prestige — see lib/plans/eligibility.ts).
    const { rows: userRows } = await db.query<{
      plan: string;
      prestige_count: number;
      is_admin: boolean;
      is_moderator: boolean;
      business_tier: string | null;
    }>(
      `SELECT COALESCE(u.plan, 'free') AS plan, COALESCE(u.prestige_count, 0) AS prestige_count,
              COALESCE(u.is_admin, false) AS is_admin, COALESCE(u.is_moderator, false) AS is_moderator,
              ba.tier AS business_tier
       FROM users u
       LEFT JOIN business_accounts ba ON ba.user_id = u.id AND ba.status = 'active'
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) throw forbidden('User not found');
    const eligibilityContext = {
      businessTier: user.business_tier,
      isAdmin: user.is_admin,
      isModerator: user.is_moderator,
    };

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSectionsRaw, onlineStatusAllowed] = await Promise.all([
      getAllowedPlans('privacy_can_lock_profile', allEligibilityOptionsExcept(['free', 'plus'])),
      getAllowedPlans('privacy_can_hide_sections', allEligibilityOptionsExcept(['free'])),
      getAllowedPlans('privacy_can_disable_friend_requests', allEligibilityOptionsExcept(['free'])),
      getAllowedPlans('privacy_hideable_sections', VALID_SECTIONS),
      getAllowedPlans('privacy_can_show_online_status', ['pro', 'max', 'prestige_1']),
    ]);

    const updates: Record<string, SqlParam> = {};

    if (body.profile_private !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, lockAllowed, eligibilityContext)) {
        throw forbidden('Your plan does not allow locking your profile');
      }
      updates.profile_private = Boolean(body.profile_private);
    }

    if (body.profile_hidden_sections !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, hideAllowed, eligibilityContext)) {
        throw forbidden('Your plan does not allow hiding profile sections');
      }
      const sections = Array.isArray(body.profile_hidden_sections)
        ? body.profile_hidden_sections.filter((s) => hideableSectionsRaw.includes(s))
        : [];
      updates.profile_hidden_sections = JSON.stringify(sections);
    }

    if (body.disable_friend_requests !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, noFrAllowed, eligibilityContext)) {
        throw forbidden('Your plan does not allow disabling friend requests');
      }
      updates.disable_friend_requests = Boolean(body.disable_friend_requests);
    }

    if (body.sitemap_opt_out !== undefined) {
      updates.sitemap_opt_out = Boolean(body.sitemap_opt_out);
    }

    if (body.show_online_status !== undefined) {
      if (!userEligible(user.plan, user.prestige_count, onlineStatusAllowed, eligibilityContext)) {
        throw forbidden('Your plan does not allow showing your online status');
      }
      updates.show_online_status = Boolean(body.show_online_status);
    }

    if (body.group_invite_privacy !== undefined) {
      if (!['anybody', 'friends', 'nobody'].includes(body.group_invite_privacy)) {
        throw badRequest('group_invite_privacy must be one of: anybody, friends, nobody');
      }
      updates.group_invite_privacy = body.group_invite_privacy;
    }

    if (body.nemesis_opt_out !== undefined) {
      updates.nemesis_opt_out = Boolean(body.nemesis_opt_out);
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

    // Take effect immediately rather than waiting for the weekly refresh —
    // deactivate any assignment where this user is the one WITH a nemesis.
    // (Existing rows where this user is someone else's nemesis are left
    // alone; that side settles on the next weekly refresh via
    // refreshNemesisAssignments' candidate-pool filter.)
    if (updates.nemesis_opt_out === true) {
      await db.query(
        `UPDATE nemesis_assignments SET is_active = false
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      ).catch(() => {});
    }

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
      is_admin: boolean;
      is_moderator: boolean;
      business_tier: string | null;
      profile_private: boolean;
      profile_hidden_sections: string[];
      disable_friend_requests: boolean;
      sitemap_opt_out: boolean;
      show_online_status: boolean;
      group_invite_privacy: string;
      nemesis_opt_out: boolean;
    }>(
      `SELECT COALESCE(u.plan, 'free') AS plan,
              COALESCE(u.prestige_count, 0) AS prestige_count,
              COALESCE(u.is_admin, false) AS is_admin,
              COALESCE(u.is_moderator, false) AS is_moderator,
              ba.tier AS business_tier,
              COALESCE(u.profile_private, false) AS profile_private,
              COALESCE(u.profile_hidden_sections, '[]'::jsonb) AS profile_hidden_sections,
              COALESCE(u.disable_friend_requests, false) AS disable_friend_requests,
              COALESCE(u.sitemap_opt_out, false) AS sitemap_opt_out,
              COALESCE(u.show_online_status, false) AS show_online_status,
              COALESCE(u.group_invite_privacy, 'friends') AS group_invite_privacy,
              COALESCE(u.nemesis_opt_out, false) AS nemesis_opt_out
       FROM users u
       LEFT JOIN business_accounts ba ON ba.user_id = u.id AND ba.status = 'active'
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // "Eligible for nemesis" (PRD §2.3/§7: Nemesis activates at Fighter,
    // Level 15) — approximated here as "has ever been assigned one", the
    // same real-world signal assignNemesis() itself uses, so the opt-out
    // toggle only appears once the system has actually engaged with this
    // user rather than duplicating a separate level table client-side.
    const { rows: nemesisRows } = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM nemesis_assignments WHERE user_id = $1) AS exists`,
      [userId]
    );
    const nemesisEligible = nemesisRows[0]?.exists === true || user.nemesis_opt_out;
    const eligibilityContext = {
      businessTier: user.business_tier,
      isAdmin: user.is_admin,
      isModerator: user.is_moderator,
    };

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSections, onlineStatusAllowed] = await Promise.all([
      getAllowedPlans('privacy_can_lock_profile', allEligibilityOptionsExcept(['free', 'plus'])),
      getAllowedPlans('privacy_can_hide_sections', allEligibilityOptionsExcept(['free'])),
      getAllowedPlans('privacy_can_disable_friend_requests', allEligibilityOptionsExcept(['free'])),
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
        group_invite_privacy: user.group_invite_privacy,
        nemesis_opt_out: user.nemesis_opt_out,
      },
      capabilities: {
        canLockProfile: userEligible(user.plan, user.prestige_count, lockAllowed, eligibilityContext),
        canHideSections: userEligible(user.plan, user.prestige_count, hideAllowed, eligibilityContext),
        canDisableFriendRequests: userEligible(user.plan, user.prestige_count, noFrAllowed, eligibilityContext),
        canShowOnlineStatus: userEligible(user.plan, user.prestige_count, onlineStatusAllowed, eligibilityContext),
        hideableSections,
        nemesisEligible,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
