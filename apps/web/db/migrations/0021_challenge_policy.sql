-- Challenge inbox policy; retain administrator customizations.
BEGIN;
UPDATE x_manifest SET value = '48' WHERE key = 'game_challenge_expiry_hours' AND value = '720';
INSERT INTO x_manifest (key, value, description) VALUES
 ('game_challenge_expiry_hours', '48', 'Hours before a challenge expires.'),
 ('game_challenge_daily_limit', '10', 'Maximum challenges sent per user per UTC day.'),
 ('game_challenge_recent_days', '7', 'Recent activity window for challenge opponent suggestions.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO quest_templates (title, description, action_type, target_count, xp_reward, coin_reward, category, feature_key, track, is_active)
SELECT title, description, action_type, 1, xp_reward, 0, 'games', 'games', 'explorer', TRUE FROM (VALUES
 ('Send a challenge', 'Invite someone to a game.', 'challenge_send', 100),
 ('Accept a challenge', 'Accept a game invitation.', 'challenge_accept', 150),
 ('Win a challenge', 'Win a game challenge.', 'challenge_win', 250)
) AS quests(title, description, action_type, xp_reward)
WHERE NOT EXISTS (SELECT 1 FROM quest_templates qt WHERE qt.action_type = quests.action_type);
COMMIT;
