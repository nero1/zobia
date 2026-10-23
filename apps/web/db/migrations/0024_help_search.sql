BEGIN;
ALTER TABLE help_docs ADD COLUMN IF NOT EXISTS search_vector tsvector
 GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_markdown, ''))) STORED;
CREATE INDEX IF NOT EXISTS help_docs_search_vector_idx ON help_docs USING gin(search_vector);
COMMIT;
