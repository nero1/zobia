import { and, eq, isNull, sql } from "drizzle-orm";
import { verifyAccessToken, JwtVerificationError } from "./jwt";
import { getSessionFresh } from "./session";
import { getDb, schema } from "@/lib/db/drizzle";
import { unauthorized } from "@/lib/api/errors";

/** The same live trust boundary for API, SSR and short-lived hand-offs. */
export async function authenticateAccessToken(token: string) {
  let payload;
  try { payload = await verifyAccessToken(token); }
  catch(error){if(error instanceof JwtVerificationError)throw unauthorized("Invalid or expired access token");throw error;}
  if (payload.type === "pre_auth" || !payload.sid) throw unauthorized("Complete sign-in first");
  const session = await getSessionFresh(payload.sid);
  if (!session || session.uid !== payload.sub) throw unauthorized("Session revoked");
  const db = await getDb();
  const active = (id: string) => and(
    eq(schema.users.id, id), isNull(schema.users.deletedAt), eq(schema.users.isBanned, false),
    sql`NOT (COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
  );
  const [user] = await db.select({
    id: schema.users.id, email: schema.users.email, username: schema.users.username,
    is_admin: schema.users.isAdmin, is_moderator: schema.users.isModerator,
    is_support: schema.users.isSupport, is_senior_support: schema.users.isSeniorSupport,
    is_creator: schema.users.isCreator, onboarding_completed: schema.users.onboardingCompleted,
  }).from(schema.users).where(and(active(payload.sub),sql`${schema.users.sessionValidAfter}<=${session.created_at}::timestamptz`)).limit(1);
  if (!user) throw unauthorized("Account unavailable");
  if (session.impersonatedBy) {
    const [actor] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(active(session.impersonatedBy), eq(schema.users.isAdmin,true))).limit(1);
    if (!actor || Date.now()-new Date(session.created_at).getTime() >= 900_000)
      throw unauthorized("Impersonation expired");
  }
  return { payload, session, user };
}
