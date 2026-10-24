"use client";
import {useEffect} from 'react';
import {getPendingMessages,updateMessageStatus,dequeueMessage,resetSendingMessages} from './messageQueue';
const backoff=(attempts:number)=>Math.min(60000,2000*2**Math.max(0,attempts-1));
/** Account-owned, cancellable retries; the server also rejects a changed cookie principal. */
export function useOfflineSync(ownerId:string|null):void{
 useEffect(()=>{
  if(!ownerId)return;
  const controller=new AbortController();let running=false,identityFailures=0,timer:ReturnType<typeof setTimeout>|undefined;
  const flush=async()=>{
   if(running||controller.signal.aborted||!navigator.onLine)return;
   running=true;let retryAt=Infinity,hadPending=false;
   try{
    const pending=await getPendingMessages(ownerId);if(!pending.length)return;hadPending=true;
    const identity=await fetch('/api/users/me',{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!identity.ok){if(![401,403].includes(identity.status)){identityFailures++;retryAt=Date.now()+backoff(identityFailures);}return;}
    const principal=await identity.json();
    if((principal.data?.id??principal.user?.id??principal.id)!==ownerId)return;
    identityFailures=0;
    for(const message of pending){
     if(controller.signal.aborted||!navigator.onLine)break;
     const due=(message.lastAttemptAt??0)+backoff(message.attempts);
     if(message.lastAttemptAt && message.lastAttemptAt<=Date.now() && Date.now()<due){retryAt=Math.min(retryAt,due);continue;}
     const attempts=message.attempts+1;
     await updateMessageStatus(message.id,{status:'sending',attempts,lastAttemptAt:Date.now()});
     try{
      const response=await fetch('/api/messages/dm',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({queueOwnerId:ownerId,recipientId:message.recipientId,content:message.content,messageType:message.messageType,mediaUrl:message.mediaUrl,idempotencyKey:message.idempotencyKey})});
      if(response.ok){await dequeueMessage(message.id);continue;}
      const permanent=attempts>=5 || (response.status>=400 && response.status<500 && ![408,429].includes(response.status));
      await updateMessageStatus(message.id,{status:permanent?'failed':'pending'});
      if(!permanent){const serverDelay=Number(response.headers.get('Retry-After'));retryAt=Math.min(retryAt,Date.now()+Math.max(backoff(attempts),Number.isFinite(serverDelay)&&serverDelay>0?Math.min(serverDelay*1000,300000):0));}
     }catch{
      await updateMessageStatus(message.id,{status:attempts>=5?'failed':'pending'});
      if(attempts<5)retryAt=Math.min(retryAt,Date.now()+backoff(attempts));
     }
    }
   }catch{if(hadPending){identityFailures++;retryAt=Date.now()+backoff(identityFailures);}}
   finally{
    running=false;
    if(Number.isFinite(retryAt)&&!controller.signal.aborted&&navigator.onLine)timer=setTimeout(()=>void flush(),Math.max(500,retryAt-Date.now())*(1+Math.random()*.25));
   }
  };
  const online=()=>{if(timer)clearTimeout(timer);void flush();};
  window.addEventListener('online',online);window.addEventListener('zobia-offline-queue',online);
  void resetSendingMessages(ownerId).then(flush).catch(()=>{});
  return()=>{controller.abort();if(timer)clearTimeout(timer);window.removeEventListener('online',online);window.removeEventListener('zobia-offline-queue',online);};
 },[ownerId]);
}
