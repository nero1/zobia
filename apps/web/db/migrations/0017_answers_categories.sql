-- 0017_answers_categories.sql
--
-- Answers categories: add "Religion and Spirituality", and split
-- "School & Career" into "Schools and Education" + "Career and Jobs".
-- The existing school-career row is renamed in place (not deleted) so any
-- questions already filed under it keep a valid category_id — it becomes
-- "Schools and Education" and a new "Career and Jobs" category is added
-- alongside it.

UPDATE forum_categories
SET slug = 'schools-education',
    name = 'Schools and Education',
    description = 'Studying, exams, and school life.',
    icon_emoji = '🎓',
    updated_at = NOW()
WHERE slug = 'school-career';

INSERT INTO forum_categories (slug, name, description, icon_emoji, sort_order) VALUES
    ('career-jobs', 'Career and Jobs', 'Job hunting, interviews, workplace advice, and figuring out what''s next.', '💼', 4),
    ('religion-spirituality', 'Religion and Spirituality', 'Faith, belief, spiritual growth, and religious discussion.', '🙏', 8)
ON CONFLICT (slug) DO NOTHING;
