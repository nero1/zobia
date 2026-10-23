import {fixtures,request,userToken,otherToken,otherId} from './fixture';
beforeAll(fixtures);
it('cannot update another account through extra profile body fields',async()=>{
 const before=(await(await request('/api/users/me',otherToken)).json()).user;
 const response=await request('/api/users/me',userToken,{method:'PUT',body:JSON.stringify({id:otherId,userId:otherId,display_name:'Fixture name'})});
 expect([200,400]).toContain(response.status);
 const after=(await(await request('/api/users/me',otherToken)).json()).user;expect(after.display_name).toBe(before.display_name);
});
it('cannot read a real private conversation belonging to other accounts',async()=>{
 const id=process.env.SECURITY_TEST_PRIVATE_CONVERSATION_ID;if(!id)throw new Error('Private conversation fixture missing');
 expect([403,404]).toContain((await request(`/api/messages/dm/${id}`)).status);
});
it('creates an expiring own-data export and rejects a changed request identity',async()=>{
 const response=await request('/api/users/me/export',userToken,{method:'POST',body:'{}'});expect(response.status).toBe(200);
 const {data}=await response.json();expect(new Date(data.expiresAt).getTime()-Date.now()).toBeLessThanOrEqual(15*60_000);
 const url=new URL(data.downloadUrl);url.pathname=`/api/users/me/export/${otherId}`;
 expect((await fetch(url)).status).toBe(401);
});
