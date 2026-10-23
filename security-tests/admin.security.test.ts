import {fixtures,request,adminToken,userId} from './fixture';
beforeAll(fixtures);
it.each(['/api/admin/users','/api/admin/email-settings','/api/admin/leaderboards','/api/admin/audit-logs'])('rejects a regular user on real admin route %s',async path=>expect((await request(path)).status).toBe(403));
it('protects administrators from their own moderation action',async()=>{
 const profile=(await(await request('/api/users/me',adminToken)).json()).user;
 const response=await request(`/api/admin/users/${profile.id}/actions`,adminToken,{method:'POST',body:JSON.stringify({action:'suspend',duration_hours:24,reason:'Fixture self action'})});
 expect(response.status).toBe(400);
});
it('keeps the actual audit endpoint immutable',async()=>expect((await request('/api/admin/audit-logs',adminToken,{method:'DELETE'})).status).toBe(405));
