-- Migration 0011: module_analyses table for Claude AI analysis storage
-- Stores analysis results (from Claude or fallback) per user per module

CREATE TABLE IF NOT EXISTS module_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  module_code TEXT NOT NULL,
  global_score INTEGER DEFAULT 0,
  global_level TEXT DEFAULT 'Insuffisant',
  analysis_json TEXT NOT NULL,
  source TEXT DEFAULT 'fallback',         -- 'claude' or 'fallback'
  error_message TEXT,                      -- if fallback was used due to error
  regenerate_count INTEGER DEFAULT 0,      -- track how many times regenerated
  last_regenerate_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, module_code)
);

CREATE INDEX IF NOT EXISTS idx_module_analyses_user_module ON module_analyses(user_id, module_code);
