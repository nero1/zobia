import {and,eq,isNull,sql} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {getManifestValue} from '@/lib/manifest';
import {enforceRateLimit,RATE_LIMITS} from '@/lib/security/rateLimit';
interface UserRow {
  id: string;
  email: string;
  username: string;
  google_id: string | null;
  is_email_verified: boolean | null;
  is_admin: boolean;
  is_moderator: boolean;
  is_creator: boolean;
  is_banned: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  suspended_until: string | null;
  ban_reason: string | null;
  deleted_at: string | null;
  totp_enabled: boolean;
  onboarding_completed: boolean;
  display_name: string | null;
  avatar_emoji: string | null;
  avatar_url: string | null;
  city: string | null;
  xp_total: number;
  rank_name: string | null;
  plan: string | null;
}

// ---------------------------------------------------------------------------
// Drizzle select-column map — aliased to the UserRow (snake_case) shape so
// the rest of this file (originally written against raw db.query rows) did
// not need to be rewritten field-by-field.
// ---------------------------------------------------------------------------

const userSelectCols = {
  id: schema.users.id,
  email: schema.users.email,
  username: schema.users.username,
  google_id: schema.users.googleId,
  is_email_verified: schema.users.isEmailVerified,
  is_admin: schema.users.isAdmin,
  is_moderator: schema.users.isModerator,
  is_creator: schema.users.isCreator,
  is_banned: schema.users.isBanned,
  is_suspended: schema.users.isSuspended,
  suspension_reason: schema.users.suspensionReason,
  suspended_until: schema.users.suspendedUntil,
  ban_reason: schema.users.banReason,
  deleted_at: schema.users.deletedAt,
  totp_enabled: schema.users.totpEnabled,
  onboarding_completed: schema.users.onboardingCompleted,
  display_name: schema.users.displayName,
  avatar_emoji: schema.users.avatarEmoji,
  avatar_url: schema.users.avatarUrl,
  city: schema.users.city,
  xp_total: schema.users.xpTotal,
  rank_name: schema.users.rankName,
  plan: schema.users.plan,
} as const;

/** Normalize a Drizzle row (bigint xp_total) into the plain UserRow shape. */
function toUserRow(row: Record<string, unknown>): UserRow {
  const xp = (row as { xp_total?: unknown }).xp_total;
  return {
    ...(row as unknown as UserRow),
    xp_total: typeof xp === "bigint" ? Number(xp) : ((xp as number) ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rate-limit (tighter than the general auth limiter — RATE_LIMITS.loginBlocked)
 * and throw a distinct, structured error for a blocked (suspended/banned)
 * login attempt, carrying everything the login UI and the appeal pipeline
 * need: the specific reason, when a suspension lifts, and enough identity to
 * issue an appeal token.
 */
async function throwBlockedAccountError(u: UserRow): Promise<never> {
  // Keyed by userId — identity is already established via Google's verified
  // profile at this point, so a suspended/banned account can't be hammered
  // past the general per-IP `RATE_LIMITS.auth` check by retrying login.
  await enforceRateLimit(u.id, "user", RATE_LIMITS.loginBlocked);
  if (u.is_banned) {
    throw Object.assign(new Error("Account is banned"), {
      code: "ACCOUNT_BANNED",
      userId: u.id,
      email: u.email ?? null,
      reason: u.ban_reason ?? null,
      suspendedUntil: null,
    });
  }
  throw Object.assign(new Error("Account is suspended"), {
    code: "ACCOUNT_SUSPENDED",
    userId: u.id,
    email: u.email ?? null,
    reason: u.suspension_reason ?? null,
    suspendedUntil: u.suspended_until ?? null,
  });
}

/** Derive a base username from an email address (part before @, lowercased, non-alphanumeric stripped). */
function baseUsernameFromEmail(email: string): string {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "user";
}

// Maximum username length enforced by the DB schema constraint (BUG-58)
const DB_USERNAME_MAX_LENGTH = 30;

/** Find a unique username by appending a numeric suffix if the base is taken. */
async function uniqueUsername(base: string): Promise<string> {
  // BUG-C03: Sanitize base before embedding in SQL ~ (POSIX regex) operator.
  // Any caller could pass a string with regex metacharacters, which would cause
  // wrong matches (e.g. '.' matches any char) or catastrophic backtracking (ReDoS).
  // Strip to only safe alphanumeric/underscore characters.
  const safeBase = base.replace(/[^a-z0-9_]/gi, "").slice(0, DB_USERNAME_MAX_LENGTH) || "user";
  const orm = await getDb();
  const rows = await orm
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(
      and(
        sql`(${schema.users.username} = ${safeBase} OR ${schema.users.username} ~ ('^' || ${safeBase} || '[0-9]+$'))`,
        isNull(schema.users.deletedAt)
      )
    );
  const taken = new Set(rows.map((r) => r.username));
  if (!taken.has(safeBase)) return safeBase;
  for (let i = 2; i < 10_000; i++) {
    const suffix = String(i);
    const candidate = `${safeBase.slice(0, DB_USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Last-resort fallback: 4-char random suffix, sliced to fit
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${safeBase.slice(0, DB_USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/** Upsert the user in the database, returning the existing or new record. */
export async function upsertGoogleUser(profile: {
  googleId: string;
  email: string;
  name: string;
  picture: string;
}): Promise<UserRow> {
  // Check if a user with this Google ID already exists (including soft-deleted for reactivation)
  const orm = await getDb();
  const [existingRow] = await orm
    .select(userSelectCols)
    .from(schema.users)
    .where(eq(schema.users.googleId, profile.googleId))
    .limit(1);

  if (existingRow) {
    const u = toUserRow(existingRow);
    if (u.is_banned || (u.is_suspended && (!u.suspended_until || new Date(u.suspended_until).getTime()>Date.now()))) await throwBlockedAccountError(u);
    // Reactivate if within grace period (soft-deleted but identifiers intact)
    if (u.deleted_at) {
      if (Date.now()-new Date(u.deleted_at).getTime() >= 30*86400_000) throw new Error("The account restoration period has ended");
      const restored = await orm
        .update(schema.users)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(schema.users.id, u.id), sql`${schema.users.deletedAt} > NOW()-INTERVAL '30 days'`, isNull(schema.users.purgedAt)))
        .returning({id:schema.users.id});
      if (!restored.length) throw new Error("The account restoration period has ended");
      u.deleted_at = null;
    }
    return u;
  }

  // Check if email is already associated with a different account (no google_id match)
  const [emailMatchRow] = await orm
    .select(userSelectCols)
    .from(schema.users)
    .where(and(eq(schema.users.email, profile.email), isNull(schema.users.deletedAt)))
    .limit(1);

  if (emailMatchRow) {
    const u = toUserRow(emailMatchRow);
    if (u.is_banned || (u.is_suspended && (!u.suspended_until || new Date(u.suspended_until).getTime()>Date.now()))) await throwBlockedAccountError(u);

    // Only auto-link if the existing account's google_id is already set
    // (clean re-auth path — e.g. google_id was stored from a previous session).
    // If google_id is null the account was created via a different method
    // (email/password, Telegram, etc.) and auto-linking without confirmation
    // would allow account takeover via a verified-email claim from Google.
    // We allow linking only when the existing account's email is marked as
    // verified (email_verified = true), which indicates the user previously
    // proved ownership of that address on this platform.
    if(u.google_id!==null)throw Object.assign(new Error("Sign in with the linked account before changing its Google identity"),{code:"ACCOUNT_LINK_REQUIRED"});

    if (u.is_email_verified === true) {
      // Existing account has a verified email — safe to link Google ID
      const linked=await orm
        .update(schema.users)
        .set({
          googleId: profile.googleId,
          avatarUrl: sql`COALESCE(${schema.users.avatarUrl}, ${profile.picture})`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.users.id,u.id),isNull(schema.users.googleId),eq(schema.users.isEmailVerified,true),isNull(schema.users.deletedAt),eq(schema.users.isBanned,false),sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`))
        .returning(userSelectCols);
      if(linked[0])return toUserRow(linked[0]);
      const [winner]=await orm.select(userSelectCols).from(schema.users).where(and(eq(schema.users.id,u.id),eq(schema.users.googleId,profile.googleId),isNull(schema.users.deletedAt),eq(schema.users.isBanned,false)));
      if(winner)return toUserRow(winner);
      throw Object.assign(new Error("The account changed during Google linking"),{code:"ACCOUNT_LINK_REQUIRED"});
    }

    throw Object.assign(new Error("Sign in to the existing account before linking Google"),{code:"ACCOUNT_LINK_REQUIRED"});
  }

  // Signups toggle (/gate44/config, /gate44/users Settings tab) — only
  // blocks brand-new account creation; existing users above already
  // returned before reaching this point, so they can always still log in.
  const signupsEnabledRaw = await getManifestValue("signups_enabled");
  if (signupsEnabledRaw === "false") {
    throw Object.assign(new Error("Signups are currently disabled"), {
      code: "SIGNUPS_DISABLED",
    });
  }

  // Generate a unique username derived from the email
  const username = await uniqueUsername(baseUsernameFromEmail(profile.email));

  // Create a brand-new user (onboarding not yet complete).
  // Retry on unique-violation (23505) for username — uniqueUsername() may race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateUsername = attempt === 0 ? username : await uniqueUsername(baseUsernameFromEmail(profile.email));
    try {
      const [inserted] = await orm
        .insert(schema.users)
        .values({
          googleId: profile.googleId,
          email: profile.email,
          username: candidateUsername,
          displayName: profile.name,
          avatarUrl: profile.picture,
          onboardingCompleted: false,
          isAdmin: false,
          isEmailVerified: true,
        })
        .returning(userSelectCols);
      if (inserted) return toUserRow(inserted);
    } catch (insertErr) {
      const pgErr = insertErr as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
      const code = pgErr.code ?? pgErr.cause?.code;
      const constraint = pgErr.constraint ?? pgErr.cause?.constraint;
      if (code === "23505") {
        // BUG-L07: distinguish username race from email race.
        // If the email unique constraint fired, a concurrent request just beat us
        // to the insert — look up and return that newly-created row instead of
        // retrying the insert (which would just fail again for the same reason).
        const constraintName = constraint ?? "";
        if (constraintName.includes("email") || constraintName.includes("google")) {
          const [raceMatch] = await orm
            .select(userSelectCols)
            .from(schema.users)
            .where(and(eq(schema.users.googleId,profile.googleId),isNull(schema.users.deletedAt)))
            .limit(1);
          if (raceMatch) {
            const recovered=toUserRow(raceMatch);
            if(recovered.is_banned||(recovered.is_suspended&&(!recovered.suspended_until||new Date(recovered.suspended_until).getTime()>Date.now())))await throwBlockedAccountError(recovered);
            return recovered;
          }
          throw Object.assign(new Error("Account ownership must be confirmed before linking Google"),{code:"ACCOUNT_LINK_REQUIRED"});
        }
        if (attempt < 2) continue;
      }
      throw insertErr;
    }
  }

  throw new Error("Failed to create user record after retries");
}
