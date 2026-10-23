import {fixtures,request,otherId} from './fixture';
beforeAll(fixtures);
it.each(["' OR '1'='1","'; DROP TABLE users;--",'1 UNION SELECT NULL,NULL','/*comment*/ OR 1=1'])('executes the protected search with SQL payload %s safely',async payload=>{
 const result=await request(`/api/users/search?q=${encodeURIComponent(payload)}`);expect(result.status).toBe(200);
 const body=await result.json();expect(body).toBeDefined();
});
it.each(['<script>window.pwned=1</script>','<img src=x onerror=alert(1)>'])('stores display names as JSON text %s',async payload=>{
 const result=await request('/api/users/me',undefined,{method:'PUT',body:JSON.stringify({display_name:payload})});expect(result.status).toBe(200);
 expect(result.headers.get('Content-Type')).toContain('application/json');expect((await result.json()).user.display_name).toBe(payload);
});
it('rejects an object where a profile string is required',async()=>{
 expect((await request('/api/users/me',undefined,{method:'PUT',body:JSON.stringify({display_name:{$ne:null}})})).status).toBe(400);
});
it.each(['http://127.0.0.1:5432','https://169.254.169.254/latest/meta-data','https://attacker.invalid/push'])('rejects SSRF through Web Push endpoint %s',async endpoint=>{
 const token=JSON.stringify({endpoint,keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}});
 expect((await request('/api/users/push-token',undefined,{method:'POST',body:JSON.stringify({platform:'webpush',token})})).status).toBe(400);
});
