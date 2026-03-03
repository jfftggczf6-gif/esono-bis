-- Migration: Plan OVO (Plan Financier Final) analyses table
-- Stores generated plan OVO data and filled Excel base64

CREATE TABLE IF NOT EXISTS plan_ovo_analyses (
  id TEXT PRIMARY KEY,
  pme_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  extraction_json TEXT,
  analysis_json TEXT,
  filled_excel_base64 TEXT,
  score INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'generated', 'error')),
  source TEXT DEFAULT 'system',
  pays TEXT,
  kb_context TEXT,
  kb_used BOOLEAN DEFAULT 0,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_plan_ovo_pme ON plan_ovo_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_plan_ovo_user ON plan_ovo_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_ovo_status ON plan_ovo_analyses(status);
