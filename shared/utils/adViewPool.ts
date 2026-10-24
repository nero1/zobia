/** Cache creative data while consuming a distinct server-issued identity per view. */
export class AdViewPool<T extends {receipt:string;viewReceipts?:string[]}>{
 private entries=new Map<string,{ad:T|null;receipts:string[];at:number}>();
 constructor(private readonly ttlMs=300000){}
 put(placement:string,ad:T|null){
  if(this.entries.size>=64)this.entries.delete(this.entries.keys().next().value!);
  this.entries.set(placement,{ad,receipts:ad?[ad.receipt,...(ad.viewReceipts??[])]:[],at:Date.now()});
 }
 take(placement:string):T|null|undefined{
  const entry=this.entries.get(placement);
  if(!entry||Date.now()-entry.at>=this.ttlMs){this.entries.delete(placement);return undefined;}
  if(!entry.ad)return null;
  const receipt=entry.receipts.shift();
  if(!receipt){this.entries.delete(placement);return undefined;}
  const {viewReceipts:_,...creative}=entry.ad;
  return {...creative,receipt} as T;
 }
 clear(){this.entries.clear();}
}
