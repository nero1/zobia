import { loadManifest } from '@/lib/manifest';
import { sharedCached,invalidateSharedCache } from '@/lib/cache/sharedFill';
const key=(portalId:string)=>`{portal:page:v2:${portalId}}`;
export async function getCachedPortalValue<T>(portalId:string,recompute:()=>Promise<T>):Promise<T> {
  const manifest=await loadManifest();
  return sharedCached(key(portalId),manifest.portals.cacheTtlSeconds,20_000,recompute);
}
export async function invalidatePortalCache(portalId:string):Promise<void> {
  await invalidateSharedCache(key(portalId));
}
