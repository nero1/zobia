import {sql} from 'drizzle-orm';
import {getDb} from '@/lib/db/drizzle';
export const SITEMAP_SIZE=10000;
const activeUser=(alias:string)=>`EXISTS(SELECT 1 FROM users au WHERE au.id=${alias} AND au.deleted_at IS NULL AND NOT au.is_banned AND NOT au.profile_private AND NOT au.sitemap_opt_out)`;
// SQL is fixed application configuration, never taken from query parameters.
export const sitemapSources={
 profiles:`SELECT id, '/u/'||username path,updated_at FROM users WHERE deleted_at IS NULL AND NOT is_banned AND NOT profile_private AND NOT sitemap_opt_out`,
 rooms:`SELECT id,'/r/'||COALESCE(slug,id::text) path,updated_at FROM rooms WHERE type='free_open' AND deleted_at IS NULL AND is_active AND is_public AND status='active' AND NOT is_banned AND NOT is_suspended AND ${activeUser('creator_id')}`,
 classrooms:`SELECT id,'/c/'||COALESCE(slug,id::text) path,updated_at FROM rooms WHERE type='classroom' AND deleted_at IS NULL AND is_active AND is_public AND status='active' AND NOT is_banned AND NOT is_suspended AND ${activeUser('creator_id')}`,
 games:`SELECT id,'/g/'||slug path,updated_at FROM games WHERE deleted_at IS NULL AND is_active AND is_public AND ${activeUser('creator_id')}`,
 questions:`SELECT id,'/a/'||COALESCE(slug,id::text) path,updated_at FROM forum_questions WHERE deleted_at IS NULL AND status='visible' AND ${activeUser('author_id')}`,
 portals:`SELECT id,'/h/'||slug path,updated_at FROM portals WHERE status='active'`,
 blogs:`SELECT id,'/b/'||slug path,updated_at FROM blogs WHERE deleted_at IS NULL AND status='active' AND ${activeUser('owner_id')}`,
 articles:`SELECT p.id,'/b/'||b.slug||'/'||p.slug path,p.updated_at FROM blog_posts p JOIN blogs b ON b.id=p.blog_id WHERE p.deleted_at IS NULL AND p.status='published' AND b.deleted_at IS NULL AND b.status='active' AND ${activeUser('b.owner_id')}`,
 wikis:`SELECT id,'/w/'||slug path,updated_at FROM wikis WHERE deleted_at IS NULL AND status IN ('active','paused') AND ${activeUser('owner_id')}`,
 wikiPages:`SELECT p.id,'/w/'||w.slug||'/'||p.slug path,p.updated_at FROM wiki_pages p JOIN wikis w ON w.id=p.wiki_id WHERE p.deleted_at IS NULL AND p.status='published' AND w.deleted_at IS NULL AND w.status IN ('active','paused') AND ${activeUser('w.owner_id')}`,
 tweets:`SELECT id,'/t/'||id::text path,created_at updated_at FROM tweets WHERE deleted_at IS NULL AND ${activeUser('user_id')}`,
 polls:`SELECT id,'/poll/'||slug path,updated_at FROM polls WHERE deleted_at IS NULL AND status='active' AND ${activeUser('creator_id')}`,
 quizzes:`SELECT id,'/quiz/'||slug path,updated_at FROM quizzes WHERE deleted_at IS NULL AND status='active' AND ${activeUser('creator_id')}`,
 business:`SELECT p.id,'/p/'||p.slug path,p.updated_at FROM business_pages p JOIN business_accounts a ON a.id=p.business_account_id WHERE p.deleted_at IS NULL AND p.status='active' AND a.status='active' AND ${activeUser('a.user_id')}`,
 boards:`SELECT id,'/forum/'||slug path,updated_at FROM bb_boards WHERE is_active`,
 threads:`SELECT t.id,'/f/'||t.slug path,t.updated_at FROM bb_threads t JOIN bb_boards b ON b.id=t.board_id WHERE t.deleted_at IS NULL AND t.status='visible' AND b.is_active AND ${activeUser('t.author_id')}`,
 helpCategories:`SELECT id,'/help/'||slug path,updated_at FROM help_categories WHERE published`,
 helpDocs:`SELECT d.id,'/help/'||c.slug||'/'||d.slug path,d.updated_at FROM help_docs d JOIN help_categories c ON c.id=d.category_id WHERE d.published AND d.deleted_at IS NULL AND c.published`,
 tales:`SELECT id,'/t/'||slug path,updated_at FROM tales WHERE status='published' AND moderation='approved' AND ${activeUser('author_id')}`,
} as const;
export async function sitemapShards():Promise<Array<{id:string}>>{
 const db=await getDb();const shards:Array<{id:string}>=[{id:'static'}];
 for(const [name,query] of Object.entries(sitemapSources)){
  shards.push({id:`${name}__00000000-0000-0000-0000-000000000000`});
  const boundaries=await db.execute<{id:string}>(sql`SELECT id FROM (SELECT id,row_number() OVER(ORDER BY id) n FROM (${sql.raw(query)}) source) numbered WHERE n % ${SITEMAP_SIZE}=0 ORDER BY id`);
  for(const row of boundaries.rows)shards.push({id:`${name}__${row.id}`});
 }
 return shards;
}
