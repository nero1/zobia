import {Pool} from 'pg';
import Redis from 'ioredis';
export const base=process.env.SECURITY_TEST_BASE_URL??'http://127.0.0.1:3010';
export const userToken=process.env.SECURITY_TEST_USER_TOKEN??'';
export const otherToken=process.env.SECURITY_TEST_OTHER_USER_TOKEN??'';
export const adminToken=process.env.SECURITY_TEST_ADMIN_TOKEN??'';
export const userId=process.env.SECURITY_TEST_USER_ID??'';
export const otherId=process.env.SECURITY_TEST_OTHER_USER_ID??'';
export function request(path:string,token=userToken,init:RequestInit={}){
 return fetch(new URL(path,base),{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:base,...init.headers}});
}
export async function fixtures(){
 for(const [key,value]of Object.entries({userToken,otherToken,adminToken,userId,otherId}))if(!value)throw new Error(`Missing security fixture ${key}. Run only with dedicated seeded accounts.`);
 for(const token of [userToken,otherToken,adminToken])expect((await request('/api/users/me',token)).status).toBe(200);
}
function localDatabase(){
 const raw=process.env.SECURITY_TEST_DATABASE_URL;if(!raw)throw new Error('SECURITY_TEST_DATABASE_URL required');
 const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/zobia_security_test')throw new Error('Wallet fixtures require the disposable local zobia_security_test database');
 return new Pool({connectionString:raw,max:1});
}
export async function fundWallet(id:string,balance:number){
 const db=localDatabase();const client=await db.connect();
 try{await client.query('BEGIN');const owner=await client.query("SELECT id FROM users WHERE id=$1 AND email LIKE '%@security.invalid' FOR UPDATE",[id]);if(!owner.rows.length)throw new Error('Not a fixture account');
 await client.query('DELETE FROM coin_ledger WHERE user_id=$1',[id]);await client.query('UPDATE users SET coin_balance=$2 WHERE id=$1',[id,balance]);
 if(balance)await client.query("INSERT INTO coin_ledger(user_id,amount,balance_before,balance_after,transaction_type,reference_id) VALUES($1,$2,0,$2,'admin_grant',gen_random_uuid()::text)",[id,balance]);
 await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await db.end();}
}
export async function resetLimits(){
 const raw=process.env.SECURITY_TEST_REDIS_URL;if(!raw)throw new Error('Dedicated security Redis URL required');
 const url=new URL(raw);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/15')throw new Error('Rate fixtures require local Redis database 15');
 const redis=new Redis(raw);try{let cursor='0';do{const result=await redis.scan(cursor,'MATCH','*rl:*','COUNT',100);cursor=result[0];if(result[1].length)await redis.del(...result[1]);}while(cursor!=='0');}finally{await redis.quit();}
}
