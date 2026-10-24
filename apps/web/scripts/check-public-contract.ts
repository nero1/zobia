import assert from 'node:assert/strict';
import {Client} from 'pg';
import {resolvePublicRoom} from '../lib/public/resolveRoom';
import {resolvePublicBlog} from '../lib/public/resolveBlog';
import {resolvePublicTweet} from '../lib/public/resolveTweet';
import {fetchTaggedFeed} from '../lib/portals/content';
import {resolvePublicProfile} from '../lib/public/resolveProfile';
async function main(){
 if(!/^\/zobia_remediation_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL??'postgresql://invalid/').pathname))throw Error('Disposable remediation database required');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const slug='public_'+crypto.randomUUID().replaceAll('-','');let owner:string|undefined;
 try{
  owner=(await db.query('INSERT INTO users(username,email,display_name) VALUES($1,$2,$1) RETURNING id',[slug,slug+'@security.invalid'])).rows[0].id;
  const room=(await db.query('INSERT INTO rooms(creator_id,name,slug) VALUES($1,$2,$2) RETURNING id',[owner,slug])).rows[0];
  const blog=(await db.query('INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$2) RETURNING id',[owner,slug])).rows[0];
  const tweet=(await db.query("INSERT INTO tweets(user_id,content) VALUES($1,'Fixture') RETURNING id",[owner])).rows[0];
  const wiki=(await db.query('INSERT INTO wikis(owner_id,name,slug) VALUES($1,$2,$2) RETURNING id',[owner,slug])).rows[0];
  const page=(await db.query("INSERT INTO wiki_pages(wiki_id,slug,title,content_markdown,content_html,created_by,status) VALUES($1,'fixture','Fixture','Fixture','Fixture',$2,'published') RETURNING id",[wiki.id,owner])).rows[0];
  const post=(await db.query("INSERT INTO blog_posts(blog_id,author_id,title,slug,status,body_markdown,body_html) VALUES($1,$2,'Fixture','fixture','published','Fixture','Fixture') RETURNING id",[blog.id,owner])).rows[0];
  const tag=(await db.query('INSERT INTO hashtags(slug,display) VALUES($1,$1) RETURNING id',[slug])).rows[0];
  for(const [kind,id] of [['wiki_page',page.id],['blog_post',post.id]])await db.query('INSERT INTO content_hashtags(hashtag_id,content_type,content_id,author_id) VALUES($1,$2,$3,$4)',[tag.id,kind,id,owner]);
  const visible=async()=>[await resolvePublicRoom(slug,['free_open']),await resolvePublicBlog(slug),await resolvePublicTweet(tweet.id)];
  assert.ok((await visible()).every(Boolean),'Active public resources must remain reachable');
  await db.query("UPDATE users SET bio='Hidden profile marker',avatar_url='https://fixture.invalid/private-avatar.png',xp_total=777,sitemap_opt_out=true,profile_hidden_sections='[\"bio\",\"avatar\",\"xp\"]'::jsonb WHERE id=$1",[owner]);
  const profile=await resolvePublicProfile(slug);assert.equal(profile?.bio,null);assert.equal(profile?.avatar_url,null);assert.equal(profile?.xp_total,0);assert.equal(profile?.sitemap_opt_out,true);
  await db.query("UPDATE users SET is_suspended=true,suspended_until=NOW()+INTERVAL '1 day' WHERE id=$1",[owner]);assert.equal(await resolvePublicProfile(slug),null);
  await db.query("UPDATE users SET suspended_until=NOW()-INTERVAL '1 day' WHERE id=$1",[owner]);assert.ok(await resolvePublicProfile(slug));
  await db.query("UPDATE users SET is_suspended=false,suspended_until=NULL,profile_hidden_sections='[]'::jsonb WHERE id=$1",[owner]);
  console.log('PASS public profile projection hides private fields, honors effective suspension and exposes the noindex opt-out flag');

  for(const patch of ["profile_private=true","is_banned=true","is_suspended=true,suspended_until=NOW()+INTERVAL '1 day'","profile_hidden_sections='[\"rooms\",\"blogs\",\"tweets\"]'::jsonb"]){
   await db.query(`UPDATE users SET ${patch} WHERE id=$1`,[owner]);
   assert.ok((await visible()).every(value=>value===null),'Direct URLs must enforce owner privacy/standing/hidden sections');
   await db.query("UPDATE users SET profile_private=false,is_banned=false,is_suspended=false,suspended_until=NULL,profile_hidden_sections='[]'::jsonb WHERE id=$1",[owner]);
  }
  for(const patch of ['is_public=false','is_banned=true','is_suspended=true',"status='suspended'"]){
   await db.query(`UPDATE rooms SET ${patch} WHERE id=$1`,[room.id]);assert.equal(await resolvePublicRoom(slug,['free_open']),null);
   await db.query("UPDATE rooms SET is_public=true,is_banned=false,is_suspended=false,status='active' WHERE id=$1",[room.id]);
  }
  assert.equal((await fetchTaggedFeed(tag.id,{types:['wiki_page','blog_post'],sort:'new',limit:10})).items.length,2);
  await db.query("UPDATE blogs SET status='suspended' WHERE id=$1",[blog.id]);await db.query("UPDATE wikis SET status='banned' WHERE id=$1",[wiki.id]);
  assert.equal((await fetchTaggedFeed(tag.id,{types:['wiki_page','blog_post'],sort:'new',limit:10})).items.length,0,'Tagged children must honor parent moderation');
  await db.query('DELETE FROM content_hashtags WHERE hashtag_id=$1',[tag.id]);await db.query('DELETE FROM hashtags WHERE id=$1',[tag.id]);
  await db.query('DELETE FROM rooms WHERE id=$1',[room.id]);
  console.log('PASS direct public room/blog/tweet privacy, account standing and room moderation; Portal parent Wiki/blog moderation');
 }finally{await db.end();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
