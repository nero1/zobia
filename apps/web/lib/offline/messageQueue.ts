/** Bounded, account-owned IndexedDB message storage. Legacy ownerless rows are discarded. */
const DB_NAME='zobia_offline',DB_VERSION=3,STORE_NAME='message_queue';
const MAX_PER_OWNER=100,MAX_TOTAL=1000,RETENTION_MS=7*86400000;
export type PendingMessageStatus='pending'|'sending'|'failed';
export interface PendingMessage{
 id:string;ownerId:string;conversationId:string|null;recipientId:string;content:string;
 messageType:'text'|'gif'|'moment';mediaUrl?:string;idempotencyKey:string;
 status:PendingMessageStatus;attempts:number;createdAt:number;lastAttemptAt:number|null;
}
let dbPromise:Promise<IDBDatabase>|null=null;
function ownerKey(ownerId:string){if(!/^[a-f0-9-]{36}$/i.test(ownerId))throw Error('An account ID is required for offline messages');return ownerId;}
function openDB():Promise<IDBDatabase>{
 if(dbPromise)return dbPromise;
 dbPromise=new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof window==='undefined'||!('indexedDB' in window)){reject(Error('IndexedDB unavailable'));return;}
  let blocked=false;
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=event=>{
   const database=request.result;
   const store=database.objectStoreNames.contains(STORE_NAME)?request.transaction!.objectStore(STORE_NAME):database.createObjectStore(STORE_NAME,{keyPath:'id'});
   if((event as IDBVersionChangeEvent).oldVersion<2)store.clear();
   for(const [name,key] of [['status','status'],['createdAt','createdAt'],['ownerId','ownerId'],['ownerStatus',['ownerId','status']],['ownerKey',['ownerId','idempotencyKey']]] as const){if(!store.indexNames.contains(name))store.createIndex(name,key as string|string[],{unique:false});}
  };
  request.onsuccess=()=>{
   const database=request.result;if(blocked){database.close();return;}
   database.onversionchange=()=>{database.close();dbPromise=null;};resolve(database);
  };
  request.onblocked=()=>{blocked=true;reject(Error('Close other Zobia tabs to update offline storage, then retry.'));};
  request.onerror=()=>reject(request.error);
 }).catch(error=>{dbPromise=null;throw error;});
 return dbPromise;
}
function requestValue<T>(request:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
function changed(){window.dispatchEvent(new Event('zobia-offline-queue'));}
/** Resolve writes only after commit; a request's success event can still be followed by abort. */
async function write<T>(operation:(store:IDBObjectStore,result:(value:T)=>void,fail:(error:Error)=>void)=>void):Promise<T>{
 const database=await openDB();
 return new Promise<T>((resolve,reject)=>{
  const tx=database.transaction(STORE_NAME,'readwrite');let result:T,failure:Error|undefined;
  const fail=(error:Error)=>{failure=error;tx.abort();};
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure??tx.error??Error('Offline write failed'));tx.onabort=()=>reject(failure??tx.error??Error('Offline write aborted'));
  try{operation(tx.objectStore(STORE_NAME),value=>{result=value;},fail);}catch(error){tx.abort();reject(error);}
 });
}
export async function enqueueMessage(message:Omit<PendingMessage,'id'|'status'|'attempts'|'createdAt'|'lastAttemptAt'>):Promise<PendingMessage>{
 ownerKey(message.ownerId);
 if(message.content.length>2000 || (message.mediaUrl?.length??0)>2048 || !message.idempotencyKey || message.idempotencyKey.length>128)throw Error('Invalid offline message');
 const pending:PendingMessage={...message,id:crypto.randomUUID(),status:'pending',attempts:0,createdAt:Date.now(),lastAttemptAt:null};
 const result=await write<PendingMessage>((store,done,fail)=>{
  const prune=store.index('createdAt').openCursor(IDBKeyRange.upperBound(Date.now()-RETENTION_MS));
  prune.onsuccess=()=>{
   const cursor=prune.result;if(cursor){cursor.delete();cursor.continue();return;}
   const existing=store.index('ownerKey').get([message.ownerId,message.idempotencyKey]);
   existing.onsuccess=()=>{
    if(existing.result){
     const previous=existing.result as PendingMessage;
     if(previous.recipientId!==message.recipientId || previous.content!==message.content || previous.messageType!==message.messageType || previous.mediaUrl!==message.mediaUrl){fail(Error("This offline operation key already belongs to another message."));return;}
     done(previous);return;
    }
    const ownerCount=store.index('ownerId').count(message.ownerId);
    ownerCount.onsuccess=()=>{
     if(ownerCount.result>=MAX_PER_OWNER){fail(Error("Your offline queue is full. Send or remove queued messages before adding more."));return;}
     const total=store.count();total.onsuccess=()=>{if(total.result>=MAX_TOTAL){fail(Error("Offline storage is full on this device."));return;}store.put(pending);done(pending);};
    };
   };
  };
 });
 changed();return result;
}
async function messages(ownerId:string,status?:PendingMessageStatus):Promise<PendingMessage[]>{
 const database=await openDB(),store=database.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME);
 const rows=await requestValue(status?store.index('ownerStatus').getAll([ownerKey(ownerId),status],MAX_PER_OWNER):store.index('ownerId').getAll(ownerKey(ownerId),MAX_PER_OWNER));
 return (rows as PendingMessage[]).filter(row=>row.createdAt>Date.now()-RETENTION_MS).sort((a,b)=>a.createdAt-b.createdAt);
}
export async function getPendingMessages(ownerId:string){return messages(ownerId,'pending');}
export async function updateMessageStatus(id:string,updates:Partial<Pick<PendingMessage,'status'|'attempts'|'lastAttemptAt'>>):Promise<void>{
 await write<void>((store,done)=>{const request=store.get(id);request.onsuccess=()=>{if(request.result)store.put({...request.result,...updates});done();};});
}
export async function dequeueMessage(id:string):Promise<void>{await write<void>((store,done)=>{store.delete(id);done();});}
export async function getQueueCounts(ownerId:string):Promise<Record<PendingMessageStatus,number>>{
 const counts={pending:0,sending:0,failed:0};for(const row of await messages(ownerId))if(row.status in counts)counts[row.status]++;return counts;
}
export async function clearQueue(ownerId:string):Promise<void>{
 await write<void>((store,done)=>{const request=store.index('ownerId').openCursor(ownerKey(ownerId));request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}else done();};});
}
async function reset(ownerId:string,status:PendingMessageStatus):Promise<number>{
 return write<number>((store,done)=>{const request=store.index('ownerStatus').getAll([ownerKey(ownerId),status],MAX_PER_OWNER);request.onsuccess=()=>{const rows=request.result as PendingMessage[];for(const row of rows)store.put({...row,status:'pending',...(status==='failed'?{attempts:0,lastAttemptAt:null}:{})});done(rows.length);};});
}
export async function resetSendingMessages(ownerId:string){return reset(ownerId,'sending');}
export async function retryFailed(ownerId:string){const count=await reset(ownerId,'failed');changed();return count;}
