-- Migration 021: Passive ingestion hardening (SQLite)
-- Adds dedup hash and source metadata to captures

ALTER TABLE captures ADD COLUMN dedup_hash TEXT;
ALTER TABLE captures ADD COLUMN source_event_id TEXT;
ALTER TABLE captures ADD COLUMN source_channel TEXT;
ALTER TABLE captures ADD COLUMN dedup_result TEXT DEFAULT NULL;
ALTER TABLE captures ADD COLUMN processing_notes TEXT;

-- Index for fast exact dedup lookups
CREATE INDEX IF NOT EXISTS idx_captures_dedup_hash ON captures (project_id, dedup_hash);

-- Index for source event tracking (prevent re-processing same event)
CREATE INDEX IF NOT EXISTS idx_captures_source_event ON captures (project_id, source_event_id);
