-- Business Plan analyses table
CREATE TABLE IF NOT EXISTS business_plan_analyses (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  pme_id TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  template_docx_path TEXT,
  business_plan_json TEXT,
  generated_docx_base64 TEXT,
  status TEXT DEFAULT 'pending',
  pays TEXT,
  kb_context TEXT,
  kb_used BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_business_plan_pme ON business_plan_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_business_plan_user ON business_plan_analyses(user_id);
