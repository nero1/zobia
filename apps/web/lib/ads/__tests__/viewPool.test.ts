import {AdViewPool} from '@zobia/shared/utils';
describe('cached creative view receipts',()=>{
 it('uses every receipt once and requests another bundle after exhaustion',()=>{
  const pool=new AdViewPool<{receipt:string;viewReceipts?:string[];title:string}>();
  pool.put('feed',{receipt:'view-1',viewReceipts:['view-2','view-3'],title:'Creative'});
  expect([pool.take('feed')?.receipt,pool.take('feed')?.receipt,pool.take('feed')?.receipt]).toEqual(['view-1','view-2','view-3']);
  expect(pool.take('feed')).toBeUndefined();
 });
 it('expires bundles and clears all receipt ownership on account changes',()=>{
  const clock=jest.spyOn(Date,'now').mockReturnValue(1000);
  try{
   const pool=new AdViewPool(100);
   pool.put('feed',{receipt:'old',viewReceipts:['unused']});clock.mockReturnValue(1100);
   expect(pool.take('feed')).toBeUndefined();
   pool.put('feed',{receipt:'another'});pool.clear();expect(pool.take('feed')).toBeUndefined();
   pool.put('feed',null);expect(pool.take('feed')).toBeNull();
  }finally{clock.mockRestore();}
 });
});
