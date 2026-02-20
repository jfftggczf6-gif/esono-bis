-- Add inputs_html and framework_html to the type CHECK constraint
-- for entrepreneur_deliverables (extends 0016 which added bmc_html and sic_html)

-- Step 1: Create new table with all HTML types
CREATE TABLE IF NOT EXISTS entrepreneur_deliverables_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'diagnostic', 'framework', 'bmc_analysis', 'sic_analysis', 'plan_ovo', 'business_plan', 'odd',
    'bmc_html', 'sic_html', 'inputs_html', 'framework_html'
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
INSERT OR IGNORE INTO entrepreneur_deliverables_new 
SELECT * FROM entrepreneur_deliverables;

-- Step 3: Swap tables
DROP TABLE IF EXISTS entrepreneur_deliverables;
ALTER TABLE entrepreneur_deliverables_new RENAME TO entrepreneur_deliverables;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_ed_user_type ON entrepreneur_deliverables(user_id, type);
CREATE INDEX IF NOT EXISTS idx_ed_user_version ON entrepreneur_deliverables(user_id, version);
