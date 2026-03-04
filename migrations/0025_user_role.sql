-- Add role column to users table
-- Supports: 'entrepreneur', 'coach'
-- Default is NULL (forces role selection on first login)
ALTER TABLE users ADD COLUMN role TEXT CHECK(role IN ('entrepreneur', 'coach'));
