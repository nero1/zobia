import {z} from 'zod';
import {sql,type SQLWrapper} from 'drizzle-orm';
import {badRequest} from './errors';
export const cursorTimestamp=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/).refine(value=>Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19)===value.slice(0,19));
export function encodePageCursor(scope:string,data:unknown){return Buffer.from(JSON.stringify({v:1,scope,data})).toString('base64url');}
export function decodePageCursor<T extends z.ZodTypeAny>(value:string|null|undefined,scope:string,shape:T):z.infer<T>|null{
 if(!value)return null;
 try{if(value.length>4096)throw Error();const parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(parsed.v!==1||parsed.scope!==scope)throw Error();return shape.parse(parsed.data);}catch{throw badRequest('This page cursor is invalid or expired. Refresh the list.','INVALID_CURSOR');}
}
/** Preserve PostgreSQL microseconds when dates are part of a keyset. */
export function cursorTime(column:SQLWrapper){return sql<string>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;}
