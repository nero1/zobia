import {readBoundedBytes,readBoundedJson,readBoundedFormData} from '../requestBody';
describe('request body limits',()=>{
 it('rejects an oversized declared body before reading',async()=>{
  const request=new Request('https://example.invalid',{method:'POST',headers:{'content-length':'100'}});
  await expect(readBoundedBytes(request,10)).rejects.toMatchObject({status:413});
 });
 it('counts actual bytes even when the length header understates them',async()=>{
  const request=new Request('https://example.invalid',{method:'POST',body:'x'.repeat(100),headers:{'content-length':'1'}});
  await expect(readBoundedBytes(request,10)).rejects.toMatchObject({status:413});
 });
 it('parses an ordinary JSON body',async()=>{
  await expect(readBoundedJson(new Request('https://example.invalid',{method:'POST',body:'{"hello":"world"}'}))).resolves.toEqual({hello:'world'});
 });
 it('preserves multipart fields within the limit',async()=>{
  const form=new FormData();form.set('name','hello');
  const result=await readBoundedFormData(new Request('https://example.invalid',{method:'POST',body:form}));
  expect(result.get('name')).toBe('hello');
 });
 it('rejects deeply nested JSON before schema validation can recurse',async()=>{
  await expect(readBoundedJson(new Request('https://example.invalid',{method:'POST',body:'['.repeat(40)+'0'+']'.repeat(40)}))).rejects.toMatchObject({status:413});
 });
 it('returns a client error for malformed JSON and multipart input',async()=>{
  await expect(readBoundedJson(new Request('https://example.invalid',{method:'POST',body:'{bad json'}))).rejects.toMatchObject({status:400});
  await expect(readBoundedFormData(new Request('https://example.invalid',{method:'POST',body:'invalid',headers:{'Content-Type':'multipart/form-data'}}))).rejects.toMatchObject({status:400});
 });
 it('rejects an oversized stream without waiting for a hostile cancellation promise',async()=>{
  const request={headers:new Headers(),body:new ReadableStream<Uint8Array<ArrayBuffer>>({start(controller){controller.enqueue(new Uint8Array(20));},cancel(){return new Promise(()=>{});}})};
  await expect(readBoundedBytes(request,10)).rejects.toMatchObject({status:413});
 });

});
