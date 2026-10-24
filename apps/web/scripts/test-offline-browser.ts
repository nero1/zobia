import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
async function main(){
 let owner=alice;
 const sends:Array<{owner:string;body:{queueOwnerId:string;content:string};at:number}>=[];
 const paths:string[]=[];
 const server=createServer(async(request,response)=>{
  paths.push(request.url??"unknown");
  if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><div id="root"></div>');return;}
  let body='';for await(const chunk of request)body+=chunk;
  response.setHeader('Content-Type','application/json');
  if(request.url==='/fixture/owner'){owner=JSON.parse(body).owner;response.end('{}');return;}
  if(request.url==='/api/users/me'){response.end(JSON.stringify({data:{id:owner}}));return;}
  if(request.url==='/api/messages/dm'){
   const data=JSON.parse(body);sends.push({owner,body:data,at:Date.now()});
   response.statusCode=data.queueOwnerId!==owner?409:sends.length===1?503:200;
   response.end('{}');return;
  }
  response.statusCode=404;response.end('{}');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No local fixture address');
 const origin=`http://127.0.0.1:${address.port}`;
 const bundled=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import * as queue from './lib/offline/messageQueue';import {useOfflineSync} from './lib/offline/useOfflineSync';let online=false,changeOwner;Object.defineProperty(navigator,'onLine',{get:()=>online});window.fixture={...queue,setOnline(value){online=value;if(value)window.dispatchEvent(new Event('online'));},async setOwner(owner){await fetch('/fixture/owner',{method:'POST',body:JSON.stringify({owner})});changeOwner(owner);}};function App(){const [owner,setOwner]=useState('${alice}');changeOwner=setOwner;useOfflineSync(owner);window.fixture.ready=true;return null;}createRoot(document.getElementById('root')).render(React.createElement(App));`,resolveDir:resolve('.'),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.addInitScript({content:"globalThis.__name=(value)=>value;"});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);
  await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('zobia_offline',1);open.onupgradeneeded=()=>{open.result.createObjectStore('message_queue',{keyPath:'id'}).put({id:'ownerless',status:'pending',createdAt:Date.now()});};open.onsuccess=()=>{open.result.close();resolve();};open.onerror=()=>reject(open.error);});});
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.waitForFunction(()=>Boolean((window as any).fixture?.ready));
  const result=await page.evaluate(async({alice,bob})=>{
   const f=(window as any).fixture;
   if((await f.getPendingMessages(alice)).length)throw Error('Legacy ownerless row survived');
   const input=(ownerId:string,content:string,key:string)=>({ownerId,content,recipientId:alice,conversationId:null,messageType:'text',idempotencyKey:key});
   const a=await f.enqueueMessage(input(alice,'from-A','alice-1'));
   const duplicate=await f.enqueueMessage(input(alice,'from-A','alice-1'));
   if(a.id!==duplicate.id)throw Error('Offline enqueue duplicated an operation');
   const b=await f.enqueueMessage(input(bob,'from-B','bob-1'));
   if((await f.getPendingMessages(alice)).length!==1||(await f.getPendingMessages(bob)).length!==1)throw Error('Queue account partition failed');
   const original=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const request=original.apply(this,args);if((args[0] as any).content==='abort-fixture')request.addEventListener('success',()=>this.transaction.abort());return request;};
   let aborted=false;
   try{await f.enqueueMessage(input(alice,'abort-fixture','abort-operation'));}catch{aborted=true;}finally{IDBObjectStore.prototype.put=original;}
   if(!aborted || (await f.getPendingMessages(alice)).length!==1)throw Error('Aborted offline transaction was acknowledged');
   await f.setOwner(bob);f.setOnline(true);
   return {aliceMessage:a.id,bobMessage:b.id};
  },{alice,bob});
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){
    const counts=await page.evaluate(async bob=>await (window as any).fixture.getQueueCounts(bob),bob);
    if(sends.length===2 && counts.pending+counts.sending+counts.failed===0)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(sends.length!==2)console.error(JSON.stringify({paths,queues:await page.evaluate(async({alice,bob})=>({alice:await (window as any).fixture.getQueueCounts(alice),bob:await (window as any).fixture.getQueueCounts(bob)}),{alice,bob})}));
  assert.equal(sends.length,2);assert.ok(sends.every(send=>send.owner===bob && send.body.queueOwnerId===bob && send.body.content==='from-B'));assert.ok(sends[1].at-sends[0].at>=1800);
  await page.evaluate(async({alice,bob,id})=>{
   const f=(window as any).fixture;f.setOnline(false);
   await f.updateMessageStatus(id,{status:'failed',attempts:5});
   if(await f.retryFailed(bob)!==0 || await f.retryFailed(alice)!==1)throw Error('Manual retry crossed accounts');
   for(let index=1;index<100;index++)await f.enqueueMessage({ownerId:alice,content:'Fixture',recipientId:bob,conversationId:null,messageType:'text',idempotencyKey:'bounded-'+index});
   let rejected=false;try{await f.enqueueMessage({ownerId:alice,content:'Too many',recipientId:bob,conversationId:null,messageType:'text',idempotencyKey:'over-cap'});}catch{rejected=true;}
   if(!rejected)throw Error('Offline queue did not enforce its owner cap');
   await f.clearQueue(bob);if((await f.getQueueCounts(alice)).pending!==100)throw Error('Clearing another account removed this account queue');
  },{alice,bob,id:result.aliceMessage});
  console.log('PASS real Chromium IndexedDB: legacy isolation, account partition, commit/abort correctness, automatic retry/backoff, owner-scoped retry/clear and bounded storage');
 }finally{await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
