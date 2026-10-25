export interface RealtimeEventData {id:string;channel:string;event:string;data:unknown}
const ID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function realtimeEventId(value:unknown):string|null {
 if(!value || typeof value!=='object')return null;
 const id=(value as {eventId?:unknown}).eventId;
 return typeof id==='string' && ID.test(id)?id:null;
}
/** Bound memory and HTTP work; concurrent subscribers share a short batch.
 * Payloads are not cached: each new delivery crosses the live auth boundary. */
export function createRealtimeEventResolver(load:(ids:string[])=>Promise<RealtimeEventData[]>) {
 type Pending={promise:Promise<RealtimeEventData>;resolve:(event:RealtimeEventData)=>void;reject:(error:Error)=>void};
 const pending=new Map<string,Pending>(),queue=new Set<string>();
 let timer:ReturnType<typeof setTimeout>|null=null,busy=false,cooldownUntil=0;
 const schedule=()=>{if(!busy && !timer && queue.size)timer=setTimeout(()=>{timer=null;void flush();},50);};
 const flush=async()=>{
  busy=true;
  const ids=[...queue].slice(0,20);ids.forEach(id=>queue.delete(id));
  try{
   const records=await load(ids),byId=new Map(records.map(item=>[item.id,item]));
   for(const id of ids){const item=byId.get(id),entry=pending.get(id);pending.delete(id);if(!entry)continue;
    if(item && typeof item.channel==='string' && typeof item.event==='string')entry.resolve(item);
    else entry.reject(new Error('Realtime event unavailable'));
   }
  }catch(error){
   const hint=error && typeof error==='object'?(error as {retryAfterMs?:unknown}).retryAfterMs:undefined;
   const delay=typeof hint==='number' && Number.isFinite(hint)?Math.min(60000,Math.max(1000,hint)):1000;
   cooldownUntil=Date.now()+delay*(0.85+Math.random()*0.3);
   for(const id of pending.keys()){pending.get(id)!.reject(new Error('Realtime temporarily unavailable'));pending.delete(id);}
   queue.clear();
  }finally{busy=false;schedule();}
 };
 return (id:string,channel:string):Promise<RealtimeEventData>=>{
  if(!ID.test(id) || Date.now()<cooldownUntil)return Promise.reject(new Error('Realtime temporarily unavailable'));
  let entry=pending.get(id);
  if(!entry){
   if(pending.size>=200)return Promise.reject(new Error('Realtime queue full'));
   let resolve!:(event:RealtimeEventData)=>void,reject!:(error:Error)=>void;
   const promise=new Promise<RealtimeEventData>((yes,no)=>{resolve=yes;reject=no;});
   entry={promise,resolve,reject};pending.set(id,entry);queue.add(id);schedule();
  }
  return entry.promise.then(event=>{if(event.channel!==channel)throw new Error('Realtime channel mismatch');return event;});
 };
}
