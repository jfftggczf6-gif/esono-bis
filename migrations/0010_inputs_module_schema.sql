-- ═══════════════════════════════════════════════════════════════
-- Migration 0010: Add 9-tab JSON columns to financial_inputs + input_alerts
-- Module 3 Inputs Financiers: 9 onglets structurés
-- ═══════════════════════════════════════════════════════════════

-- Add 9-tab JSON columns to existing financial_inputs table
ALTER TABLE financial_inputs ADD COLUMN infos_generales_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN donnees_historiques_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN produits_services_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN ressources_humaines_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN hypotheses_croissance_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN couts_fixes_variables_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN bfr_tresorerie_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN investissements_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN financement_json TEXT;

-- Computed scores for the 9-tab engine
ALTER TABLE financial_inputs ADD COLUMN completeness_pct INTEGER DEFAULT 0;
ALTER TABLE financial_inputs ADD COLUMN readiness_score INTEGER DEFAULT 0;
ALTER TABLE financial_inputs ADD COLUMN analysis_json TEXT;
ALTER TABLE financial_inputs ADD COLUMN analysis_timestamp DATETIME;

-- Financial ratios snapshot
ALTER TABLE financial_inputs ADD COLUMN marge_brute_pct REAL;
ALTER TABLE financial_inputs ADD COLUMN marge_op_pct REAL;
ALTER TABLE financial_inputs ADD COLUMN marge_nette_pct REAL;
ALTER TABLE financial_inputs ADD COLUMN ca_annee_n REAL;
ALTER TABLE financial_inputs ADD COLUMN ca_cible_an5 REAL;

-- Input alerts history table
CREATE TABLE IF NOT EXISTS input_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  module_id INTEGER NOT NULL,
  tab_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  alert_level TEXT NOT NULL CHECK(alert_level IN ('error', 'warning', 'info')),
  message TEXT NOT NULL,
  rule_name TEXT,
  resolved INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_input_alerts_user ON input_alerts(user_id, module_id);
