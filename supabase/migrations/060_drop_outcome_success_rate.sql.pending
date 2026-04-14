-- Migration 060 (PENDING): Drop decisions.outcome_success_rate (Phase 14)
--
-- ⚠️  This file is intentionally named ``*.sql.pending`` so it is NOT picked
-- up by the default migration glob (``supabase/migrations/*.sql``). Rename
-- it to ``060_drop_outcome_success_rate.sql`` only after:
--
--   1. Migration 058 (view) has been live ≥ 14 days.
--   2. Migration 059 (backfill) ran cleanly in prod and the gap-check
--      query returns zero rows.
--   3. Compile-score snapshot diffs show <1% variance across the cutover
--      (the parity target set in the Phase 14 plan).
--   4. All readers of decisions.outcome_success_rate have been removed
--      (grep the codebase; migrate reflection-engine, memory-analytics,
--      impact-predictor callers to getUnifiedOutcomeStats first).
--
-- Once renamed, this drops the legacy column and the (now-unused)
-- recomputeOutcomeAggregates UPDATE path that writes to it. Callers must
-- route through ``decision_outcome_stats`` / ``getUnifiedOutcomeStats``.

-- Belt-and-braces existence check so an accidental re-run doesn't error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'decisions'
      AND column_name = 'outcome_success_rate'
  ) THEN
    ALTER TABLE decisions DROP COLUMN outcome_success_rate;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'decisions'
      AND column_name = 'outcome_count'
  ) THEN
    ALTER TABLE decisions DROP COLUMN outcome_count;
  END IF;
END$$;

COMMENT ON VIEW decision_outcome_stats IS
  'Canonical source of per-decision outcome aggregates after migration 060. '
  'Read via getUnifiedOutcomeStats() in packages/core/src/intelligence/outcome-memory.ts.';
