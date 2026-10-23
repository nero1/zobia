import {base,fixtures,request,resetLimits} from './fixture';
beforeAll(fixtures);
it('returns Retry-After on a real authentication throttle',async()=>{
 await resetLimits();let limited:Response|undefined;
 for(let i=0;i<25;i++){const response=await fetch(`${base}/api/admin/auth/login`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'rate@security.invalid',password:'incorrect'})});if(response.status===429){limited=response;break;}expect(response.status).toBe(401);}
 expect(limited).toBeDefined();expect(limited!.headers.get('Retry-After')).not.toBeNull();
},60000);
it('rejects cross-origin cookie authentication mutations',async()=>{
 const response=await fetch(`${base}/api/admin/auth/login`,{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'rate@security.invalid',password:'incorrect'})});
 expect(response.status).toBe(403);
});
