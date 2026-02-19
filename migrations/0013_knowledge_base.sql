-- Migration 0013: Knowledge Base — Sources, Benchmarks, Critères, Bailleurs
-- Alimente les agents IA avec des données de référence enrichissables

-- ═══ Sources de données (URLs, documents, rapports) ═══
CREATE TABLE IF NOT EXISTS kb_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK(category IN (
    'funder', 'institution', 'benchmark', 'regulation',
    'methodology', 'template', 'market_study', 'report'
  )),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT,
  data_json TEXT,            -- structured data extracted from source
  region TEXT,               -- e.g. 'UEMOA', 'CEMAC', 'Afrique de l''Ouest'
  relevance_score INTEGER DEFAULT 50,  -- 0-100, how relevant for IR analysis
  last_verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_sources_category ON kb_sources(category);
CREATE INDEX IF NOT EXISTS idx_kb_sources_region ON kb_sources(region);

-- ═══ Bailleurs de fonds (Enabel, GIZ, BAD, BM, AFD, etc.) ═══
CREATE TABLE IF NOT EXISTS kb_funders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- e.g. 'enabel', 'giz', 'afdb'
  name TEXT NOT NULL,
  full_name TEXT,
  type TEXT CHECK(type IN ('bilateral', 'multilateral', 'dfi', 'impact_fund', 'foundation', 'government')),
  country TEXT,
  region TEXT,
  website TEXT,
  annual_report_url TEXT,
  focus_sectors TEXT,                  -- JSON array: ["agriculture", "digital", "energy"]
  eligibility_criteria TEXT,           -- JSON: min revenue, max employees, sectors, countries
  typical_ticket_min REAL,             -- in EUR
  typical_ticket_max REAL,
  instrument_types TEXT,               -- JSON: ["grant", "loan", "equity", "guarantee"]
  application_process TEXT,
  success_rate REAL,                   -- %
  avg_processing_months REAL,
  key_contacts TEXT,                   -- JSON
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_funders_type ON kb_funders(type);
CREATE INDEX IF NOT EXISTS idx_kb_funders_region ON kb_funders(region);

-- ═══ Benchmarks sectoriels ═══
CREATE TABLE IF NOT EXISTS kb_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL,                -- e.g. 'agriculture', 'digital_services', 'agritech'
  metric TEXT NOT NULL,                -- e.g. 'gross_margin_pct', 'cac_eur', 'ltv_cac_ratio'
  region TEXT,                         -- e.g. 'UEMOA', 'Afrique de l''Ouest'
  value_low REAL,
  value_median REAL,
  value_high REAL,
  unit TEXT,                           -- '%', 'EUR', 'months', 'ratio'
  source_id INTEGER,
  year INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES kb_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_kb_benchmarks_sector ON kb_benchmarks(sector);
CREATE INDEX IF NOT EXISTS idx_kb_benchmarks_metric ON kb_benchmarks(metric);
CREATE INDEX IF NOT EXISTS idx_kb_benchmarks_sector_metric ON kb_benchmarks(sector, metric);

-- ═══ Paramètres fiscaux et réglementaires ═══
CREATE TABLE IF NOT EXISTS kb_fiscal_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,               -- e.g. 'CI', 'SN', 'BF'
  zone TEXT,                           -- e.g. 'UEMOA', 'CEMAC'
  param_code TEXT NOT NULL,            -- e.g. 'tva_rate', 'corporate_tax', 'social_charges'
  param_label TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,                           -- '%', 'EUR', 'XOF'
  effective_date TEXT,
  source_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES kb_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_kb_fiscal_country ON kb_fiscal_params(country);
CREATE INDEX IF NOT EXISTS idx_kb_fiscal_zone ON kb_fiscal_params(zone);
CREATE INDEX IF NOT EXISTS idx_kb_fiscal_code ON kb_fiscal_params(param_code);

-- ═══ Critères d'évaluation Investment Readiness ═══
CREATE TABLE IF NOT EXISTS kb_evaluation_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension TEXT NOT NULL,             -- 'modele_economique', 'impact_social', etc.
  criterion_code TEXT UNIQUE NOT NULL,
  criterion_label TEXT NOT NULL,
  description TEXT,
  weight REAL DEFAULT 1.0,             -- relative weight in scoring
  max_score INTEGER DEFAULT 100,
  scoring_guide TEXT,                  -- JSON: how to score each level
  required_documents TEXT,             -- JSON: which documents needed
  funder_relevance TEXT,               -- JSON: which funders care about this
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_criteria_dimension ON kb_evaluation_criteria(dimension);

-- ═══ Historique des analyses (feedback loop) ═══
-- Stores expert validations and corrections to improve future analyses
CREATE TABLE IF NOT EXISTS kb_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  deliverable_id TEXT,                 -- ref entrepreneur_deliverables.id
  deliverable_type TEXT,
  dimension TEXT,
  original_score INTEGER,
  corrected_score INTEGER,
  expert_comment TEXT,
  correction_type TEXT CHECK(correction_type IN ('score_adjustment', 'content_improvement', 'missing_info', 'methodology')),
  applied BOOLEAN DEFAULT 0,           -- has this feedback been used to improve the system
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_kb_feedback_type ON kb_feedback(deliverable_type);
CREATE INDEX IF NOT EXISTS idx_kb_feedback_dimension ON kb_feedback(dimension);

-- ═══ Agent prompts versionnés ═══
-- Stores system prompts for each agent, allowing iteration without code changes
CREATE TABLE IF NOT EXISTS kb_agent_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_code TEXT NOT NULL,            -- 'bmc_analyst', 'sic_analyst', 'finance_analyst', etc.
  version INTEGER DEFAULT 1,
  system_prompt TEXT NOT NULL,
  output_schema TEXT,                  -- JSON schema the agent must follow
  temperature REAL DEFAULT 0.3,
  max_tokens INTEGER DEFAULT 4096,
  is_active BOOLEAN DEFAULT 1,
  performance_notes TEXT,              -- notes on how well this version performs
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_prompts_agent ON kb_agent_prompts(agent_code, is_active);
