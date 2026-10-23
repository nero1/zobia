'use client';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Bundle { slots:number; credits:number|null; stars:number|null; }
export function PostBundles({blogSlug,onPurchased}:{blogSlug:string;onPurchased:()=>void}) {
  const {t}=useTranslation(); const [catalog,setCatalog]=useState<Bundle[]|null>(null); const [selected,setSelected]=useState(100); const [currency,setCurrency]=useState<'credits'|'stars'>('credits');
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [success,setSuccess]=useState(false); const [confirming,setConfirming]=useState(false); const requestId=useRef<string|null>(null);
  async function load(){setBusy(true);setError('');try{ const response=await fetch(`/api/blogs/${blogSlug}/post-bundles`,{credentials:'include'});const body=await response.json();if(!response.ok)throw new Error(body.error?.message||'Unable to load bundles.');setCatalog(body.data.bundles); }catch(err){setError(err instanceof Error?err.message:t('error.generic'));}finally{setBusy(false);}}
  const price=catalog?.find((b)=>b.slots===selected)?.[currency];
  async function buy(){if(!price||busy)return;setBusy(true);setError('');requestId.current??=crypto.randomUUID();try{ const response=await fetch(`/api/blogs/${blogSlug}/post-bundles`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId.current,slots:selected,currency,confirmedCost:price})});const body=await response.json();if(!response.ok)throw new Error(body.error?.message||'Unable to purchase bundle.'); requestId.current=null;setConfirming(false);setSuccess(true);onPurchased();}catch(err){setError(err instanceof Error?err.message:t('error.generic'));}finally{setBusy(false);}}
  return <div className="mt-3 space-y-2 text-sm">
    {success&&<p role="status" className="text-emerald-600">{t('blogs.bundles.success','Extra posts added to this blog.')}</p>}
    {!catalog?<button type="button" disabled={busy} onClick={()=>void load()} className="underline">{t('blogs.bundles.open','Buy an extra-post bundle')}</button>:<>
      <p>{t('blogs.bundles.description','Permanent extra posts for this blog, including articles and pages.')}</p>
      <label>{t('blogs.bundles.size','Extra posts')} <select disabled={busy} value={selected} onChange={(e)=>{setSelected(Number(e.target.value));setConfirming(false);requestId.current=null;}} className="rounded border bg-white text-neutral-900 p-2">{catalog.map((b)=><option key={b.slots} value={b.slots}>{b.slots}</option>)}</select></label>{' '}
      <label>{t('blogs.bundles.currency','Pay with')} <select disabled={busy} value={currency} onChange={(e)=>{setCurrency(e.target.value as 'credits'|'stars');setConfirming(false);requestId.current=null;}} className="rounded border bg-white text-neutral-900 p-2"><option value="credits">{t('currency.credits','Credits')}</option><option value="stars">{t('currency.stars','Stars')}</option></select></label>
      {price?<p>{t('blogs.bundles.price','{{slots}} extra posts cost {{cost}} {{currency}}.',{slots:selected,cost:price,currency:t(`currency.${currency}`,currency)})}</p>:<p>{t('blogs.bundles.unavailable','This option is currently unavailable.')}</p>}
      {price&&(!confirming?<button type="button" disabled={busy} onClick={()=>setConfirming(true)} className="rounded-full border px-3 py-2">{t('blogs.bundles.review','Review purchase')}</button>:<div><p>{t('blogs.bundles.confirm','Deduct {{cost}} {{currency}} and add {{slots}} extra posts to this blog?',{cost:price,currency:t(`currency.${currency}`,currency),slots:selected})}</p><button type="button" disabled={busy} onClick={()=>void buy()} className="rounded-full bg-blue-600 text-white px-3 py-2">{t('blogs.bundles.buy','Confirm purchase')}</button> <button type="button" disabled={busy} onClick={()=>setConfirming(false)}>{t('common.cancel','Cancel')}</button></div>)}
    </>}
    {error&&<p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
