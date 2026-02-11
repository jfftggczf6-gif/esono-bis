-- ═══════════════════════════════════════════════════════════════
-- Migration 0009: Social Impact Canvas (Module 2 SIC) schema
-- ═══════════════════════════════════════════════════════════════

-- Table for SIC-specific structured data beyond the guided questions
CREATE TABLE IF NOT EXISTS sic_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  module_id INTEGER NOT NULL,
  progress_id INTEGER NOT NULL,

  -- Section 1: Impact Vise
  impact_problem TEXT,
  impact_transformation TEXT,
  impact_urgency TEXT,
  impact_zone TEXT,

  -- Section 2: Beneficiaires
  beneficiaries_direct_profile TEXT,
  beneficiaries_direct_count INTEGER,
  beneficiaries_indirect_count INTEGER,
  beneficiaries_total INTEGER,
  beneficiaries_involvement TEXT,

  -- Section 3: Mesure d'Impact
  kpi_principal TEXT,
  kpi_baseline TEXT,
  kpi_target_1y TEXT,
  kpi_target_3y TEXT,
  measurement_method TEXT,
  measurement_frequency TEXT,

  -- Section 4: ODD & Contribution
  odd_selected TEXT,  -- JSON array of selected ODD numbers e.g. [2, 8, 12]
  odd_targets TEXT,   -- JSON object with ODD-specific targets
  odd_contribution_direct TEXT,
  odd_contribution_indirect TEXT,
  odd_evidence TEXT,

  -- Section 5: Risques
  risks_identified TEXT,  -- JSON array of risk objects
  risks_mitigation TEXT,

  -- Scores (computed by analysis)
  score_impact_vise REAL,
  score_beneficiaires REAL,
  score_mesure REAL,
  score_odd REAL,
  score_risques REAL,
  score_global REAL,        -- /10
  score_coherence_bmc REAL, -- /10

  -- Analysis metadata
  analysis_json TEXT,         -- Full analysis result JSON
  analysis_timestamp DATETIME,
  impact_matrix_json TEXT,    -- {intentionnel, mesure, prouve}

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
  FOREIGN KEY (progress_id) REFERENCES progress(id) ON DELETE CASCADE,
  UNIQUE(user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_sic_data_user_module ON sic_data(user_id, module_id);
CREATE INDEX IF NOT EXISTS idx_sic_data_progress ON sic_data(progress_id);

-- Table for SIC deliverable tracking
CREATE TABLE IF NOT EXISTS sic_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  module_id INTEGER NOT NULL,
  deliverable_type TEXT NOT NULL CHECK(deliverable_type IN ('excel_sic', 'html_diagnostic')),
  content_json TEXT,
  score_global REAL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sic_deliverables_user ON sic_deliverables(user_id, module_id);
