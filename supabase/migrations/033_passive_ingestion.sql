-- Migration 033: Passive ingestion hardening
-- Adds dedup hash and source metadata to captures

ALTER TABLE captures ADD COLUMN IF NOT EXISTS dedup_hash TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS source_event_id TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS source_channel TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS dedup_result JSONB DEFAULT NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS processing_notes TEXT;

-- Index for fast exact dedup lookups
CREATE INDEX IF NOT EXISTS idx_captures_dedup_hash ON captures (project_id, dedup_hash) WHERE dedup_hash IS NOT NULL;

-- Index for source event tracking (prevent re-processing same event)
CREATE INDEX IF NOT EXISTS idx_captures_source_event ON captures (project_id, source_event_id) WHERE source_event_id IS NOT NULL;
