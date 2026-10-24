import { ApiError } from "@/lib/api/errors";

/** Count actual streamed bytes; Content-Length alone is never a size boundary. */
export async function readBoundedBytes(request:Pick<Request,"headers"|"body">,limit=1024*1024):Promise<Uint8Array>{
 const declared=request.headers.get("content-length");
 if(declared && Number(declared)>limit)throw new ApiError(413,"BODY_TOO_LARGE","Request body is too large");
 const reader=request.body?.getReader();
 if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];
 let length=0;
 let timeout:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new ApiError(408,"BODY_TIMEOUT","Request body took too long to receive")),15000);});
 try {
  for(;;){
   const {value,done}=await Promise.race([reader.read(),deadline]);
   if(done)break;
   length+=value.byteLength;
   if(length>limit){void reader.cancel().catch(()=>{});throw new ApiError(413,"BODY_TOO_LARGE","Request body is too large");}
   if(chunks.length>=8192)throw new ApiError(413,"BODY_TOO_COMPLEX","Request body is too fragmented");
   chunks.push(value);
  }
 }catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{clearTimeout(timeout!);reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}
export async function readBoundedJson(request:Request){
 const bytes=await readBoundedBytes(request);
 let value:ReturnType<typeof JSON.parse>;
 try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new ApiError(400,"INVALID_JSON","Request body must be valid UTF-8 JSON");}
 const pending=[{value,depth:0}];let nodes=1;
 while(pending.length){
  const item=pending.pop()!;
  if(item.depth>32)throw new ApiError(413,"BODY_TOO_COMPLEX","Request structure is too complex");
  if(item.value && typeof item.value==="object")for(const key in item.value){
   if(!Object.hasOwn(item.value,key))continue;
   if(++nodes>50000)throw new ApiError(413,"BODY_TOO_COMPLEX","Request structure is too complex");
   pending.push({value:item.value[key],depth:item.depth+1});
  }
 }
 return value;
}
export async function readBoundedFormData(request:Request):Promise<FormData>{
 const bytes=await readBoundedBytes(request,8*1024*1024);
 try{return await new Response(bytes as BodyInit,{headers:{"Content-Type":request.headers.get("Content-Type")??""}}).formData();}catch{throw new ApiError(400,"INVALID_FORM","Request body must be valid form data");}
}
