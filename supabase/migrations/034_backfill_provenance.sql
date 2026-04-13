-- Backfill provenance and trust for existing decisions that lack them
UPDATE decisions
SET provenance_chain = jsonb_build_array(jsonb_build_object(
  'source_type', COALESCE(source, 'manual'),
  'actor_type', CASE WHEN source = 'auto_distilled' THEN 'system' WHEN source = 'imported' THEN 'system' ELSE 'human' END,
  'method', CASE WHEN source = 'auto_distilled' THEN 'llm_extraction' WHEN source = 'imported' THEN 'import_sync' ELSE 'direct_entry' END,
  'verification_status', CASE WHEN validated_at IS NOT NULL THEN 'validated' WHEN status = 'pending' THEN 'pending_review' ELSE 'unverified' END,
  'timestamp', COALESCE(created_at::text, NOW()::text)
))
WHERE provenance_chain IS NULL OR provenance_chain = '[]'::jsonb;

-- Set default trust scores based on source and confidence
UPDATE decisions SET trust_score =
  CASE
    WHEN validated_at IS NOT NULL THEN 0.85
    WHEN confidence = 'high' AND source = 'manual' THEN 0.75
    WHEN confidence = 'high' THEN 0.65
    WHEN confidence = 'medium' THEN 0.55
    WHEN confidence = 'low' THEN 0.40
    ELSE 0.50
  END
WHERE trust_score IS NULL;
