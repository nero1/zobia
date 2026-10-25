import { and, eq, exists, gt, isNull, notExists, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';
import { loadClassroomContext } from '@/lib/classroom/access';
type Orm = Awaited<ReturnType<typeof getDb>>;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DM = new RegExp(`^dm:conversation:(${UUID})$`);
const ROOM = new RegExp(`^room:(${UUID})(?::messages)?$`);
const GROUP = new RegExp(`^group:(${UUID})(?::messages)?$`);
const USER = new RegExp(`^user:(${UUID})$`);
/** One live entitlement query per ordinary channel; used for both token signing
 * and payload reads. Reusable membership cannot bypass moderation or expiry. */
export async function authorizeRealtimeChannel(db:Orm,userId:string,channel:string):Promise<'ok'|'forbidden'|'unsupported'> {
 const dm=DM.exec(channel),room=ROOM.exec(channel),group=GROUP.exec(channel),user=USER.exec(channel);
 if(user)return user[1]===userId?'ok':'forbidden';
 if(dm){
  const [row]=await db.select({id:schema.dmConversations.id}).from(schema.dmConversations).where(and(eq(schema.dmConversations.id,dm[1]),or(eq(schema.dmConversations.userId1,userId),eq(schema.dmConversations.userId2,userId)))).limit(1);
  return row?'ok':'forbidden';
 }
 if(group){
  const [row]=await db.select({id:schema.groupChats.id}).from(schema.groupChats).where(and(
   eq(schema.groupChats.id,group[1]),eq(schema.groupChats.isActive,true),eq(schema.groupChats.isDeactivated,false),
   exists(db.select({id:schema.groupChatMembers.id}).from(schema.groupChatMembers).where(and(eq(schema.groupChatMembers.groupChatId,schema.groupChats.id),eq(schema.groupChatMembers.userId,userId)))),
   notExists(db.select({id:schema.groupChatBlocks.id}).from(schema.groupChatBlocks).where(and(eq(schema.groupChatBlocks.groupChatId,schema.groupChats.id),eq(schema.groupChatBlocks.userId,userId)))),
  )).limit(1);
  return row?'ok':'forbidden';
 }
 if(room){
  const [row]=await db.select({type:schema.rooms.type}).from(schema.rooms).where(and(
   eq(schema.rooms.id,room[1]),isNull(schema.rooms.deletedAt),eq(schema.rooms.status,'active'),eq(schema.rooms.isActive,true),eq(schema.rooms.isBanned,false),eq(schema.rooms.isSuspended,false),
   sql`(${schema.rooms.type}<>'drop' OR ((${schema.rooms.dropStartsAt} IS NULL OR ${schema.rooms.dropStartsAt}<=NOW()) AND (${schema.rooms.dropEndsAt} IS NULL OR ${schema.rooms.dropEndsAt}>NOW())))`,
   sql`(${schema.rooms.type}<>'limited' OR ${schema.rooms.createdAt}+(${schema.rooms.durationMinutes}*INTERVAL '1 minute')>NOW())`,
   or(
    eq(schema.rooms.type,'classroom'),eq(schema.rooms.creatorId,userId),
    and(
     exists(db.select({id:schema.roomMembers.id}).from(schema.roomMembers).where(and(eq(schema.roomMembers.roomId,schema.rooms.id),eq(schema.roomMembers.userId,userId),isNull(schema.roomMembers.leftAt)))),
     or(sql`${schema.rooms.type}<>'vip'`,exists(db.select({id:schema.roomSubscriptions.id}).from(schema.roomSubscriptions).where(and(eq(schema.roomSubscriptions.roomId,schema.rooms.id),eq(schema.roomSubscriptions.userId,userId),eq(schema.roomSubscriptions.status,'active'),gt(schema.roomSubscriptions.expiresAt,new Date()))))),
    ),
   ),
  )).limit(1);
  if(!row)return 'forbidden';
  if(row.type==='classroom'){
   const context=await loadClassroomContext({id:room[1]},userId);
   return context.viewer.can.viewMemberContent?'ok':'forbidden';
  }
  return 'ok';
 }
 return 'unsupported';
}
