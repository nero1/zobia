import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { handleApiError, notFound, forbidden } from '@/lib/api/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { getBlogBySlug } from '@/lib/blogs/repo';
import { buyPostBundle, postBundleCatalog } from '@/lib/blogs/bundles';
export const dynamic='force-dynamic';
export const GET=withAuth<{slug:string}>(async(_req,{auth,params})=>{
  try{ await enforceRateLimit(auth.user.sub,'user',RATE_LIMITS.apiRead); const blog=await getBlogBySlug(params.slug); if(!blog) throw notFound('Blog not found.'); if(blog.owner_id!==auth.user.sub) throw forbidden('Only the owner can manage bundles.'); return NextResponse.json({success:true,data:{bundles:await postBundleCatalog()},error:null}); }catch(error){return handleApiError(error);}
});
const body=z.object({requestId:z.string().uuid(),slots:z.union([z.literal(100),z.literal(200),z.literal(300),z.literal(500),z.literal(1000)]),currency:z.enum(['credits','stars']),confirmedCost:z.number().int().positive()});
export const POST=withAuth<{slug:string}>(async(req,{auth,params})=>{
  try{ await enforceRateLimit(auth.user.sub,'user',RATE_LIMITS.blogWrite); const input=await validateBody(req,body); const blog=await getBlogBySlug(params.slug); if(!blog) throw notFound('Blog not found.'); return NextResponse.json({success:true,data:await buyPostBundle(auth.user.sub,blog.id,input),error:null}); }catch(error){return handleApiError(error);}
});
