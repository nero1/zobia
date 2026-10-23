import {NextResponse} from 'next/server';
import {sitemapShards} from '@/lib/seo/sitemaps';
export const revalidate=3600;
export async function GET(){
 const base=process.env.NEXT_PUBLIC_APP_URL??'https://zobia.vercel.app';
 const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const shards=await sitemapShards();
 return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${shards.map(s=>`<sitemap><loc>${xml(`${base}/sitemaps/sitemap/${s.id}.xml`)}</loc></sitemap>`).join('')}</sitemapindex>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, s-maxage=3600, stale-while-revalidate=300'}});
}
