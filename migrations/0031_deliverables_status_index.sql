-- Migration 0031: Add composite index on entrepreneur_deliverables (user_id, type, status)
-- Optimizes queries that filter by status = 'generated' (which is now used everywhere)
CREATE INDEX IF NOT EXISTS idx_edeliverables_user_type_status ON entrepreneur_deliverables(user_id, type, status);
