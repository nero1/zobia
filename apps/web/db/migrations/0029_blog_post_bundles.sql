BEGIN;
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS extra_post_slots integer NOT NULL DEFAULT 0 CHECK(extra_post_slots >= 0);
CREATE TABLE IF NOT EXISTS blog_post_bundle_purchases (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blog_id uuid NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
 slots integer NOT NULL CHECK(slots>0), currency text NOT NULL CHECK(currency IN ('credits','stars')),
 cost integer NOT NULL CHECK(cost>0), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE blog_post_bundle_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON blog_post_bundle_purchases FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON blog_post_bundle_purchases TO service_role;
INSERT INTO x_manifest(key,value,description) VALUES
 ('blog_post_bundle_100_credits','1000','Credits for 100 permanent extra posts per blog.'),
 ('blog_post_bundle_200_credits','1900','Credits for 200 extra posts (5% discount).'),
 ('blog_post_bundle_300_credits','2700','Credits for 300 extra posts (10% discount).'),
 ('blog_post_bundle_500_credits','4250','Credits for 500 extra posts (15% discount).'),
 ('blog_post_bundle_1000_credits','8000','Credits for 1000 extra posts (20% discount).'),
 ('blog_post_bundle_100_stars','100','Stars for 100 permanent extra posts per blog.'),
 ('blog_post_bundle_200_stars','190','Stars for 200 extra posts (5% discount).'),
 ('blog_post_bundle_300_stars','270','Stars for 300 extra posts (10% discount).'),
 ('blog_post_bundle_500_stars','425','Stars for 500 extra posts (15% discount).'),
 ('blog_post_bundle_1000_stars','800','Stars for 1000 extra posts (20% discount).')
ON CONFLICT(key) DO NOTHING;
COMMIT;
