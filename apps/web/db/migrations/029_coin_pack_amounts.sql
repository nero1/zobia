-- Migration 029: Fix coin pack amounts to match PRD §11
--
-- Previous migration (028) set incorrect coin amounts:
--   Regular: 270  (PRD: 350 = 300 + 50 bonus)
--   Big:     600  (PRD: 800 = 700 + 100 bonus)
--   Baller:  1500 (PRD: 1800 = 1600 + 200 bonus)
--   Boss:    5000 (PRD: 5000 ✓)
--   Legend:  12500 (PRD: 11500 = 10000 + 1500 bonus)

UPDATE coin_packs SET coins = 350   WHERE name = 'Regular';
UPDATE coin_packs SET coins = 800   WHERE name = 'Big';
UPDATE coin_packs SET coins = 1800  WHERE name = 'Baller';
UPDATE coin_packs SET coins = 11500 WHERE name = 'Legend';
