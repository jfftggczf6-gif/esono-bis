-- Migration 0026: Coach Entrepreneurs table
-- Allows coaches to manage their portfolio of entrepreneurs

CREATE TABLE IF NOT EXISTS coach_entrepreneurs (
  id TEXT PRIMARY KEY,
  coach_user_id INTEGER NOT NULL,
  entrepreneur_name TEXT NOT NULL,
  enterprise_name TEXT,
  email TEXT,
  phone TEXT,
  sector TEXT,
  phase TEXT DEFAULT 'identite' CHECK(phase IN ('identite', 'finance', 'dossier')),
  score_ir INTEGER DEFAULT 0,
  modules_validated INTEGER DEFAULT 0,
  total_modules INTEGER DEFAULT 8,
  deliverables_count INTEGER DEFAULT 0,
  last_activity TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_entrepreneurs_coach ON coach_entrepreneurs(coach_user_id);
CREATE INDEX IF NOT EXISTS idx_coach_entrepreneurs_email ON coach_entrepreneurs(email);
CREATE INDEX IF NOT EXISTS idx_coach_entrepreneurs_phase ON coach_entrepreneurs(coach_user_id, phase);
