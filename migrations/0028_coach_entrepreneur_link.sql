-- Migration 0028: Link coach_entrepreneurs to users accounts
-- Adds linked_user_id column to connect a coach's entrepreneur record
-- to an actual user account (for Vue Miroir synchronisation)

ALTER TABLE coach_entrepreneurs ADD COLUMN linked_user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_coach_entrepreneurs_linked_user ON coach_entrepreneurs(linked_user_id);
