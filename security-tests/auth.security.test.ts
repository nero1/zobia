import {base,fixtures,request,resetLimits} from './fixture';
beforeAll(fixtures);
it.each(['invalid.token.signature','eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.',''])('rejects invalid authentication %s',async token=>{
 expect((await request('/api/users/me',token)).status).toBe(401);
});
it.each(['/api/users/me','/api/auth/sessions','/api/economy/coins/balance','/api/admin/users'])('requires authentication for %s',async path=>{
 expect((await request(path,'')).status).toBe(401);
});
it('admin login reaches its credential verifier and throttles repeated attempts',async()=>{
 await resetLimits();const statuses:number[]=[];
 for(let i=0;i<25;i++){const result=await fetch(`${base}/api/admin/auth/login`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@security.invalid',password:'incorrect'})});statuses.push(result.status);}
 expect(statuses[0]).toBe(401);expect(statuses).toContain(429);
},60000);
