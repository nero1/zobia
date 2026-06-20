-- Migration: custom bugs/gaps fixes (custom-bugs-gaps-fixes-fgk84z)
-- Addresses: BUG-WAR-DRAW-01 (wars_drawn column)

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS wars_drawn INTEGER NOT NULL DEFAULT 0;
