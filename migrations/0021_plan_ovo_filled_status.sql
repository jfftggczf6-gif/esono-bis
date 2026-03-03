-- Migration: Add 'filled' status to plan_ovo_analyses
-- Allows tracking when Excel file has been generated from extraction data

-- SQLite does not support ALTER TABLE ... ALTER COLUMN to change CHECK constraints
-- So we need to recreate the table with the new constraint

-- Step 1: Rename the existing table
ALTER TABLE plan_ovo_analyses RENAME TO plan_ovo_analyses_old;

-- Step 2: Create new table with updated CHECK constraint
CREATE TABLE plan_ovo_analyses (
  id TEXT PRIMARY KEY,
  pme_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  extraction_json TEXT,
  analysis_json TEXT,
  filled_excel_base64 TEXT,
  score INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'generated', 'filling', 'filled', 'error')),
  source TEXT DEFAULT 'system',
  pays TEXT,
  kb_context TEXT,
  kb_used BOOLEAN DEFAULT 0,
  error_message TEXT,
  fill_stats TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Step 3: Copy data from old table
INSERT INTO plan_ovo_analyses (id, pme_id, user_id, version, extraction_json, analysis_json,
  filled_excel_base64, score, status, source, pays, kb_context, kb_used, error_message, created_at, updated_at)
SELECT id, pme_id, user_id, version, extraction_json, analysis_json,
  filled_excel_base64, score, status, source, pays, kb_context, kb_used, error_message, created_at, updated_at
FROM plan_ovo_analyses_old;

-- Step 4: Drop old table
DROP TABLE plan_ovo_analyses_old;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_plan_ovo_pme ON plan_ovo_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_plan_ovo_user ON plan_ovo_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_ovo_status ON plan_ovo_analyses(status);
