import { secureGet, secureSet } from './secureTokenStore';
import { env } from '@/lib/env';

const KEY='zobia_pending_session_revocations';
type Revocation={accessToken:string|null;refreshToken:string|null;createdAt:number};
let pending:Promise<void>|null=null;
let storage:Promise<unknown>=Promise.resolve();
function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const task=storage.then(fn,fn);storage=task.catch(()=>{});return task;}
async function read():Promise<Revocation[]>{
  try{return JSON.parse(await secureGet(KEY)??'[]') as Revocation[];}catch{return [];}
}
/** Keystore-backed, bounded logout-only retry credentials, never used to sign in. */
export async function enqueueSessionRevocation(accessToken:string|null,refreshToken:string|null):Promise<void>{
  if(!accessToken&&!refreshToken)return;
  await exclusive(async()=>{
    const records=(await read()).filter(r=>Date.now()-r.createdAt<30*86400_000);
    records.push({accessToken,refreshToken,createdAt:Date.now()});
    await secureSet(KEY,JSON.stringify(records.slice(-10)));
  });
}
export function flushSessionRevocations():Promise<void>{
  if(pending)return pending;
  const task=(async()=>{
    const records=await exclusive(read);
    for(const record of records){
      try{
        const response=await fetch(`${env.VITE_API_BASE_URL}/api/auth/logout`,{
          method:'POST',headers:{...(record.accessToken?{Authorization:`Bearer ${record.accessToken}`} : {}),...(record.refreshToken?{'X-Refresh-Token':record.refreshToken}:{})},
          signal:AbortSignal.timeout(5000),
        });
        if(!response.ok)break;
        await exclusive(async()=>{
          const current=await read();
          await secureSet(KEY,JSON.stringify(current.filter(r=>r.createdAt!==record.createdAt || r.refreshToken!==record.refreshToken || r.accessToken!==record.accessToken)));
        });
      }catch{break;}
    }
  })().catch(()=>{}).finally(()=>{if(pending===task)pending=null;});
  pending=task;return task;
}
