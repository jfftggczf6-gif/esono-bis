-- Extend CHECK constraint to include diagnostic_html and diagnostic_analyses
-- The table already has: diagnostic, framework, bmc_analysis, sic_analysis, plan_ovo, business_plan, odd,
--   bmc_html, sic_html, inputs_html, framework_html, framework_pme_data
-- Adding: diagnostic_html, diagnostic_analyses

CREATE TABLE IF NOT EXISTS entrepreneur_deliverables_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN (
    'diagnostic', 'framework', 'bmc_analysis', 'sic_analysis', 'plan_ovo', 'business_plan', 'odd',
    'bmc_html', 'sic_html', 'inputs_html', 'framework_html', 'framework_pme_data',
    'diagnostic_html', 'diagnostic_analyses'
  )),
  content TEXT,
  score INTEGER,
  version INTEGER DEFAULT 1,
  iteration_id TEXT,
  status TEXT DEFAULT 'generated',
  created_at TEXT DEFAULT (datetime('now')),
  generated_by TEXT DEFAULT 'entrepreneur',
  visibility TEXT DEFAULT 'private',
  shared_at TEXT,
  coach_user_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (iteration_id) REFERENCES iterations(id)
);

INSERT OR IGNORE INTO entrepreneur_deliverables_new 
SELECT * FROM entrepreneur_deliverables;

DROP TABLE IF EXISTS entrepreneur_deliverables;
ALTER TABLE entrepreneur_deliverables_new RENAME TO entrepreneur_deliverables;

CREATE INDEX IF NOT EXISTS idx_ed_user_type ON entrepreneur_deliverables(user_id, type);
CREATE INDEX IF NOT EXISTS idx_ed_user_version ON entrepreneur_deliverables(user_id, version);
