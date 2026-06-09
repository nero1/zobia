-- Add avatar_url column to users for storing external profile picture URLs (e.g. from Google OAuth)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
