import {contributeToCreatorFund} from '../fundContribution';
import {getManifestValue} from '@/lib/manifest';
const update=jest.fn().mockResolvedValue(undefined);
const values=jest.fn(()=>({onConflictDoUpdate:update}));
jest.mock('@/lib/manifest',()=>({getManifestValue:jest.fn()}));
jest.mock('@/lib/db/drizzle',()=>({getDb:async()=>({insert:()=>({values})}),schema:{xManifest:{key:'key',value:'value'}}}));
describe('exact Creator Fund contributions',()=>{
 beforeEach(()=>{values.mockClear();jest.mocked(getManifestValue).mockResolvedValue('0.29');});
 it('does not lose a kobo to floating-point percentage rounding',async()=>{
  await contributeToCreatorFund(100000,'coin_purchase');
  expect(values).toHaveBeenCalledWith(expect.objectContaining({value:'290'}));
 });
 it('rejects fractional fiat units',async()=>{
  await expect(contributeToCreatorFund(1.5,'coin_purchase')).rejects.toThrow('exact integer kobo');
  expect(values).not.toHaveBeenCalled();
 });
 it('does not book zero revenue',async()=>{
  await contributeToCreatorFund(0,'coin_purchase');expect(values).not.toHaveBeenCalled();
 });
});
