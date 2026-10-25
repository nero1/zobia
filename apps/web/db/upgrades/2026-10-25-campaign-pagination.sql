BEGIN;
CREATE INDEX sponsored_quests_admin_page_idx ON public.sponsored_quests ((moderation_status='pending') DESC,COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX sponsored_quests_admin_active_page_idx ON public.sponsored_quests ((moderation_status='pending') DESC,COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC) WHERE deleted_at IS NULL AND is_active=true;
CREATE INDEX sponsored_quests_business_page_idx ON public.sponsored_quests (business_account_id,COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC) WHERE deleted_at IS NULL;
COMMIT;
