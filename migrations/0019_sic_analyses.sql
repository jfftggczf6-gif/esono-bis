-- Migration 0019: SIC Analyses — Stockage structuré des analyses Social Impact Canvas
-- Parallèle aux tables entrepreneur_deliverables pour un accès direct par pme_id

CREATE TABLE IF NOT EXISTS sic_analyses (
  id TEXT PRIMARY KEY,
  pme_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  extraction_json TEXT,       -- Texte extrait du DOCX structuré en JSON (sections 1-9)
  analysis_json TEXT,         -- Résultat de l'analyse Claude AI (scores, recommandations, etc.)
  html_content TEXT,          -- HTML du livrable généré
  score REAL,                 -- Score global SIC
  status TEXT DEFAULT 'uploaded' CHECK(status IN ('uploaded', 'extracted', 'extracting', 'analyzing', 'generated', 'error')),
  source_upload_id TEXT,      -- Référence vers uploads.id
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sic_analyses_pme ON sic_analyses(pme_id);
CREATE INDEX IF NOT EXISTS idx_sic_analyses_user ON sic_analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_sic_analyses_status ON sic_analyses(status);
