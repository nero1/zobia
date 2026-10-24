import {and,eq,isNull,sql,type SQL} from "drizzle-orm";
import {schema} from "@/lib/db/drizzle";
/** Shared crawlable-content boundary. Private profiles do not expose their content anonymously. */
export function publicOwnerVisible(section?:string){
 return and(isNull(schema.users.deletedAt),eq(schema.users.isBanned,false),eq(schema.users.profilePrivate,false),
  sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
  section?sql`NOT(COALESCE(${schema.users.profileHiddenSections},'[]'::jsonb) @> ${JSON.stringify([section])}::jsonb)`:undefined);
}

/** SQL form for queries whose owners are not joined through the Drizzle users table. */
export function publicOwnerExists(owner:SQL,section?:string):SQL{
 return sql`EXISTS(SELECT 1 FROM users public_owner WHERE public_owner.id=${owner} AND public_owner.deleted_at IS NULL AND public_owner.is_banned=FALSE AND public_owner.profile_private=FALSE AND NOT(COALESCE(public_owner.is_suspended,FALSE) AND (public_owner.suspended_until IS NULL OR public_owner.suspended_until>NOW())) ${section?sql`AND NOT(COALESCE(public_owner.profile_hidden_sections,'[]'::jsonb) @> ${JSON.stringify([section])}::jsonb)`:sql``})`;
}
