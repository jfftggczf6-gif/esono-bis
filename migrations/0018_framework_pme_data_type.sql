-- Add framework_pme_data type to entrepreneur_deliverables
-- This stores the serialized PmeInputData JSON for the framework Excel download

-- Step 1: Create new table with framework_pme_data type
CREATE TABLE IF NOT EXISTS entrepreneur_deliverables_new2 (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'diagnostic', 'framework', 'bmc_analysis', 'sic_analysis', 'plan_ovo', 'business_plan', 'odd',
    'bmc_html', 'sic_html', 'inputs_html', 'framework_html', 'framework_pme_data'
  )),
  content TEXT,
  score INTEGER,
  version INTEGER DEFAULT 1,
  iteration_id TEXT,
  status TEXT DEFAULT 'generated',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (iteration_id) REFERENCES iterations(id)
);

-- Step 2: Copy data
INSERT OR IGNORE INTO entrepreneur_deliverables_new2 
SELECT * FROM entrepreneur_deliverables;

-- Step 3: Swap tables
DROP TABLE IF EXISTS entrepreneur_deliverables;
ALTER TABLE entrepreneur_deliverables_new2 RENAME TO entrepreneur_deliverables;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ed_user_type ON entrepreneur_deliverables(user_id, type);
CREATE INDEX IF NOT EXISTS idx_ed_user_version ON entrepreneur_deliverables(user_id, version);
