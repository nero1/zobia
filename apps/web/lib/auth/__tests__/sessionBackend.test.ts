const mockGet=jest.fn();
const mockLimit=jest.fn();
jest.mock('@/lib/redis',()=>({redis:{get:(key:string)=>mockGet(key)}}));
jest.mock('@/lib/db/drizzle',()=>({
 schema:jest.requireActual('@/lib/db/schema').schema,
 getDb:async()=>({select:()=>({from:()=>({where:()=>({limit:mockLimit})})})}),
}));
import {getSessionFresh} from '../session';
it('does not misclassify an impersonation authority outage as a revoked session',async()=>{
 mockGet.mockResolvedValue(JSON.stringify({uid:'u',sid:'s',created_at:new Date().toISOString(),impersonatedBy:'a'}));
 mockLimit.mockRejectedValueOnce(new Error('temporary database failure'));
 await expect(getSessionFresh('s')).rejects.toThrow('temporary database failure');
});
it('still rejects invalid session JSON and missing authority',async()=>{
 mockGet.mockResolvedValueOnce('null');expect(await getSessionFresh('s')).toBeNull();
 mockGet.mockResolvedValueOnce('{');expect(await getSessionFresh('s')).toBeNull();
 mockGet.mockResolvedValueOnce(JSON.stringify({uid:'u',sid:'s',created_at:new Date().toISOString(),impersonatedBy:'a'}));
 mockLimit.mockResolvedValueOnce([]);expect(await getSessionFresh('s')).toBeNull();
});
