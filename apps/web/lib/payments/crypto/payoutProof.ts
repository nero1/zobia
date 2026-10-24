import {createHash} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {getDb,schema} from '@/lib/db/drizzle';
import {badRequest} from '@/lib/api/errors';
import {decryptField} from '@/lib/security/fieldEncryption';
import {getToken} from './tokens';
import {getChainAdapter,MIN_CONFIRMATIONS} from './chains';
import type {CryptoCurrency} from '@zobia/types';
type Snapshot=Pick<typeof schema.creatorPayouts.$inferSelect,'id'|'cryptoCurrency'|'cryptoChain'|'cryptoAmountBaseUnits'|'walletAddressSnapshot'|'createdAt'>;
export function cryptoPayoutFingerprint(snapshot:Snapshot):string{return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');}
export function readPayoutWallet(value:string,currency:CryptoCurrency):string|null{
 const adapter=getChainAdapter(getToken(currency).chain);
 return adapter.isValidAddress(value)?value:decryptField(value);
}
/** Resolve network evidence before acquiring the payout transaction's row lock. */
export async function verifyNativePayoutTransfer(payoutId:string,hash:string){
 const db=await getDb();
 const [snapshot]=await db.select({id:schema.creatorPayouts.id,cryptoCurrency:schema.creatorPayouts.cryptoCurrency,cryptoChain:schema.creatorPayouts.cryptoChain,cryptoAmountBaseUnits:schema.creatorPayouts.cryptoAmountBaseUnits,walletAddressSnapshot:schema.creatorPayouts.walletAddressSnapshot,createdAt:schema.creatorPayouts.createdAt}).from(schema.creatorPayouts).where(eq(schema.creatorPayouts.id,payoutId));
 if(!snapshot?.cryptoAmountBaseUnits)return null;
 if(!snapshot.cryptoCurrency || !['BNB','SOL','JAGA'].includes(snapshot.cryptoCurrency))throw badRequest('Invalid payout currency');
 const token=getToken(snapshot.cryptoCurrency as CryptoCurrency);
 if(token.chain!==snapshot.cryptoChain)throw badRequest('Payout chain does not match its asset');
 if(!(token.chain==='bsc'?/^0x[0-9a-fA-F]{64}$/:/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).test(hash))throw badRequest('A valid transaction hash is required','INVALID_PAYOUT_PROOF');
 const address=snapshot.walletAddressSnapshot && readPayoutWallet(snapshot.walletAddressSnapshot,token.symbol);
 if(!address)throw badRequest('The payout wallet snapshot cannot be read');
 const source=process.env[token.chain==='bsc'?'CRYPTO_PAYOUT_ADDRESS_BSC':'CRYPTO_PAYOUT_ADDRESS_SOLANA'];
 if(!source)throw badRequest('Configure the platform payout wallet before confirming a native payout','PAYOUT_WALLET_NOT_CONFIGURED');
 const adapter=getChainAdapter(token.chain);
 const transfer=await adapter.getTransfer(hash,address,token.contractAddress);
 const equal=(a:string,b:string)=>token.chain==='bsc'?a.toLowerCase()===b.toLowerCase():a===b;
 if(transfer.status!=='success' || transfer.confirmations<MIN_CONFIRMATIONS[token.chain] || !equal(transfer.from,source) || !equal(transfer.to,address) || transfer.valueBaseUnits!==BigInt(snapshot.cryptoAmountBaseUnits) || !snapshot.createdAt || !transfer.blockTime || transfer.blockTime*1000<snapshot.createdAt.getTime()-1000)throw badRequest('The transaction does not prove this payout has settled','PAYOUT_NOT_SETTLED');
 return {fingerprint:cryptoPayoutFingerprint(snapshot),chain:token.chain,hash:token.chain==='bsc'?hash.toLowerCase():hash};
}
