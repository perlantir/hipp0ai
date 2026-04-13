-- Migration 031: Add provenance chain and trust scoring
-- Additive only — no destructive changes

ALTER TABLE decisions ADD COLUMN IF NOT EXISTS provenance_chain JSONB DEFAULT '[]'::jsonb;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS trust_score FLOAT DEFAULT NULL;

-- Index for trust-based queries
CREATE INDEX IF NOT EXISTS idx_decisions_trust_score ON decisions (trust_score) WHERE trust_score IS NOT NULL;

-- Backfill existing rows with default provenance
UPDATE decisions
SET provenance_chain = jsonb_build_array(jsonb_build_object(
  'source_type', COALESCE(source, 'manual'),
  'actor_type', CASE WHEN source = 'auto_distilled' THEN 'system' WHEN source = 'imported' THEN 'system' ELSE 'human' END,
  'method', CASE WHEN source = 'auto_distilled' THEN 'llm_extraction' WHEN source = 'imported' THEN 'import_sync' WHEN source = 'auto_capture' THEN 'capture_pipeline' ELSE 'direct_entry' END,
  'verification_status', CASE WHEN validated_at IS NOT NULL THEN 'validated' WHEN status = 'pending' THEN 'pending_review' ELSE 'unverified' END,
  'timestamp', COALESCE(created_at::text, NOW()::text)
))
WHERE provenance_chain IS NULL OR provenance_chain = '[]'::jsonb;
