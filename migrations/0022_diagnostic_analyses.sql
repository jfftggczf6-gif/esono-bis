-- Migration: Diagnostic Expert analyses table
-- Stores generated diagnostic data (Investment Readiness score, 5 dimensions, risks, recommendations)

CREATE TABLE IF NOT EXISTS diagnostic_analyses (
  id TEXT PRIMARY KEY,
  pme_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  analysis_json TEXT,
  html_content TEXT,
  score INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'generated', 'partial', 'error')),
  sources_used TEXT,
  kb_context TEXT,
  kb_used BOOLEAN DEFAULT 0,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_pme ON diagnostic_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_user ON diagnostic_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_status ON diagnostic_analyses(status);
