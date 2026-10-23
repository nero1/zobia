const rpc={getTransactionReceipt:jest.fn(),getBlockNumber:jest.fn().mockResolvedValue(120n),getBlock:jest.fn().mockResolvedValue({timestamp:1700000000n}),getTransaction:jest.fn()};
jest.mock('viem',()=>({...jest.requireActual('viem'),createPublicClient:()=>rpc}));
import {bscAdapter} from '../chains/bsc';
import {toEventSelector,parseAbiItem} from 'viem';
const buyer='0x'+'11'.repeat(20),receiver='0x'+'22'.repeat(20),token='0x'+'33'.repeat(20),hash='0x'+'44'.repeat(32);
const topic=(address:string)=>'0x'+address.slice(2).padStart(64,'0');
describe('BSC deposit evidence',()=>{
 beforeEach(()=>{rpc.getTransactionReceipt.mockResolvedValue({status:'success',blockNumber:100n,logs:[]});});
 it('rejects native transfers to a different recipient',async()=>{
  rpc.getTransaction.mockResolvedValue({to:buyer,from:buyer,value:100n});
  expect((await bscAdapter.getTransfer(hash,receiver,null)).status).toBe('not_found');
  rpc.getTransaction.mockResolvedValue({to:receiver,from:buyer,value:100n});
  expect((await bscAdapter.getTransfer(hash,receiver,null)).status).toBe('success');
 });
 it('requires an exact Transfer log rather than Approval',async()=>{
  const log={address:token,topics:[toEventSelector(parseAbiItem('event Approval(address indexed owner,address indexed spender,uint256 value)')),topic(buyer),topic(receiver)],data:'0x'+(100n).toString(16).padStart(64,'0')};
  rpc.getTransactionReceipt.mockResolvedValue({status:'success',blockNumber:100n,logs:[log]});
  expect((await bscAdapter.getTransfer(hash,receiver,token)).status).toBe('not_found');
  log.topics[0]=toEventSelector(parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)'));
  expect((await bscAdapter.getTransfer(hash,receiver,token)).valueBaseUnits).toBe(100n);
 });
});
