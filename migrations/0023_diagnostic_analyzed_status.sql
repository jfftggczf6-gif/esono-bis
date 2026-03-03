-- Migration: Add 'analyzed' status to diagnostic_analyses CHECK constraint
-- The diagnostic agent now uses 'analyzed' for completed Claude analysis

-- Drop the old CHECK constraint and recreate the table with the new one
-- SQLite doesn't support ALTER TABLE to modify CHECK constraints directly

-- Step 1: Create new table with updated CHECK
CREATE TABLE IF NOT EXISTS diagnostic_analyses_new (
  id TEXT PRIMARY KEY,
  pme_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  analysis_json TEXT,
  html_content TEXT,
  score INTEGER,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'generated', 'analyzed', 'partial', 'error')),
  sources_used TEXT,
  kb_context TEXT,
  kb_used BOOLEAN DEFAULT 0,
  error_message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Step 2: Copy existing data
INSERT OR IGNORE INTO diagnostic_analyses_new 
  SELECT * FROM diagnostic_analyses;

-- Step 3: Drop old table
DROP TABLE IF EXISTS diagnostic_analyses;

-- Step 4: Rename new table
ALTER TABLE diagnostic_analyses_new RENAME TO diagnostic_analyses;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_diagnostic_pme ON diagnostic_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_user ON diagnostic_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_status ON diagnostic_analyses(status);
