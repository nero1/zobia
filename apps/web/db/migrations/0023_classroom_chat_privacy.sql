BEGIN;
-- This restriction also applies to direct Data API/realtime reads. Service-role
-- backend access remains governed by the same capability checks in the API.
DROP POLICY IF EXISTS classroom_chat_enrolment ON room_messages;
CREATE POLICY classroom_chat_enrolment ON room_messages AS RESTRICTIVE FOR SELECT
USING (
 NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = room_messages.room_id AND r.type = 'classroom')
 OR EXISTS (SELECT 1 FROM classroom_enrolments ce WHERE ce.room_id = room_messages.room_id AND ce.user_id::text = current_setting('app.current_user_id', true))
 OR EXISTS (SELECT 1 FROM rooms r WHERE r.id = room_messages.room_id AND r.creator_id::text = current_setting('app.current_user_id', true))
 OR EXISTS (SELECT 1 FROM users u WHERE u.id::text = current_setting('app.current_user_id', true) AND (u.is_admin OR u.is_moderator))
 OR EXISTS (SELECT 1 FROM classroom_moderators cm WHERE cm.room_id = room_messages.room_id AND cm.user_id::text = current_setting('app.current_user_id', true) AND cm.status = 'active' AND cm.is_moderator)
);
COMMIT;
