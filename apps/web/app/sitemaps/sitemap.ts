import type {MetadataRoute} from 'next';
import {sql} from 'drizzle-orm';
import {getDb} from '@/lib/db/drizzle';
import {sitemapShards,sitemapSources,SITEMAP_SIZE} from '@/lib/seo/sitemaps';
export const revalidate=3600;
const BASE_URL=process.env.NEXT_PUBLIC_APP_URL??'https://zobia.vercel.app';
export async function generateSitemaps(){return sitemapShards();}
export default async function sitemap({id}:{id:string|Promise<string>}):Promise<MetadataRoute.Sitemap>{
 const value=await id;
 if(value==='static')return ['','/help','/terms','/privacy','/h','/forum','/tales'].map(path=>({url:`${BASE_URL}${path}`,changeFrequency:'weekly'}));
 const [name,cursor]=value.split('__');
 if(!Object.prototype.hasOwnProperty.call(sitemapSources,name)||!/^[0-9a-f-]{36}$/.test(cursor??''))return [];
 const db=await getDb();
 const rows=await db.execute<{path:string;updated_at:Date|null}>(sql`SELECT path,updated_at FROM (${sql.raw(sitemapSources[name as keyof typeof sitemapSources])}) source WHERE id>${cursor}::uuid ORDER BY id LIMIT ${SITEMAP_SIZE}`);
 return rows.rows.filter(row=>row.path).map(row=>({url:`${BASE_URL}${row.path.split('/').map(encodeURIComponent).join('/')}`,lastModified:row.updated_at??undefined,changeFrequency:'weekly'}));
}
