BEGIN;
CREATE TABLE IF NOT EXISTS help_ai_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 question text NOT NULL,
 doc_id uuid REFERENCES help_docs(id) ON DELETE SET NULL,
 week_start timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
 answer text,
 cost_credits integer NOT NULL DEFAULT 0 CHECK (cost_credits >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS help_ai_requests_usage_idx ON help_ai_requests(user_id, week_start, status);
ALTER TABLE help_ai_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON help_ai_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON help_ai_requests TO service_role;
INSERT INTO x_manifest(key,value,description) VALUES
 ('help_ai_weekly_limit_free','20','Weekly included help AI questions: Free.'),
 ('help_ai_weekly_limit_plus','50','Weekly included help AI questions: Plus.'),
 ('help_ai_weekly_limit_pro','100','Weekly included help AI questions: Pro.'),
 ('help_ai_weekly_limit_max','200','Weekly included help AI questions: Max.'),
 ('help_ai_question_cost_credits','5','Credits for a confirmed question after the weekly allowance; zero disables paid questions.')
ON CONFLICT(key) DO NOTHING;
COMMIT;
