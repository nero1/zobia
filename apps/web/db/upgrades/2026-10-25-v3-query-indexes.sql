BEGIN;
-- Match discovery's actual chronological order; retain the existing index name.
DROP INDEX public.tales_discovery_idx;
CREATE INDEX tales_discovery_idx ON public.tales(status,moderation,created_at DESC,id DESC);
CREATE INDEX tales_author_created_page_idx ON public.tales(author_id,created_at DESC,id DESC);
CREATE INDEX tale_author_subscriptions_author_page_idx ON public.tale_author_subscriptions(author_id,user_id,created_at);
COMMIT;
