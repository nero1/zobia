import {and,eq} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {publicOwnerVisible} from './ownerVisibility';
/** Safe projection shared by public HTML, social metadata and JSON-LD. */
export async function resolvePublicProfile(username:string){
 const db=await getDb();
 const [row]=await db.select({id:schema.users.id,username:schema.users.username,display_name:schema.users.displayName,bio:schema.users.bio,avatar_url:schema.users.avatarUrl,is_creator:schema.users.isCreator,created_at:schema.users.createdAt,xp_total:schema.users.xpTotal,sitemap_opt_out:schema.users.sitemapOptOut,hidden:schema.users.profileHiddenSections}).from(schema.users).where(and(eq(schema.users.username,username),publicOwnerVisible())).limit(1);
 if(!row)return null;
 const hidden=Array.isArray(row.hidden)?row.hidden as string[]:[];
 const {hidden:_hidden,...profile}=row;
 return {...profile,bio:hidden.includes('bio')?null:row.bio,avatar_url:hidden.includes('avatar')?null:row.avatar_url,xp_total:hidden.includes('xp')?0:Number(row.xp_total),created_at:row.created_at?.toISOString()??''};
}
