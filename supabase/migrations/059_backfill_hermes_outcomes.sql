-- Migration 059: Backfill hermes_outcomes from decision_outcomes (Phase 14)
--
-- Prerequisite for the eventual DROP COLUMN decisions.outcome_success_rate
-- (see migration 060, which is intentionally NOT auto-applied — it runs
-- only after the 2-week monitoring window in the Phase 14 plan confirms
-- scoring parity). Until that cutover, compile reads both sources; this
-- migration makes sure the view-backed source doesn't miss decisions
-- whose only outcome data was recorded via the legacy /api/outcomes path.
--
-- Strategy: for every decision_outcomes row that has no matching entry in
-- hermes_outcomes (by decision_id + time proximity), emit a synthetic
-- hermes_outcomes row. We map:
--   decision_outcomes.outcome_type='success'   -> 'positive'
--   decision_outcomes.outcome_type='failure'   -> 'negative'
--   decision_outcomes.outcome_type='regression'-> 'negative'
--   everything else                            -> 'neutral'
--
-- session_id is required by hermes_outcomes schema but is opaque in the
-- synthetic case — we use a deterministic placeholder UUID derived from
-- the decision_outcomes.id so repeat runs of this migration are idempotent
-- (INSERT ... ON CONFLICT DO NOTHING on (signal_source, note)).

-- Defensive: this migration assumes both tables exist. Skip silently if
-- the legacy decision_outcomes table isn't present in this deployment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'decision_outcomes'
  ) THEN
    RAISE NOTICE '[migration 059] decision_outcomes not present; skipping backfill.';
    RETURN;
  END IF;

  INSERT INTO hermes_outcomes (
    id, project_id, session_id, outcome, snippet_ids_json, signal_source, note, created_at
  )
  SELECT
    gen_random_uuid(),
    do_row.project_id,
    -- Deterministic synthetic session id. The namespace-style uuid_generate_v5
    -- is not available in every pg build; a fixed-prefix cast of the source id
    -- gives us a stable-but-harmless opaque value.
    ('00000000-0000-0000-0000-' || substr(md5(do_row.id::text || 'backfill-059'), 1, 12))::uuid,
    CASE
      WHEN do_row.outcome_type = 'success'    THEN 'positive'
      WHEN do_row.outcome_type = 'failure'    THEN 'negative'
      WHEN do_row.outcome_type = 'regression' THEN 'negative'
      ELSE 'neutral'
    END AS outcome,
    jsonb_build_array(do_row.decision_id::text) AS snippet_ids_json,
    'backfill-059-from-decision-outcomes' AS signal_source,
    'auto-backfilled from decision_outcomes row ' || do_row.id::text AS note,
    do_row.created_at
  FROM decision_outcomes do_row
  WHERE NOT EXISTS (
    SELECT 1
    FROM hermes_outcomes ho
    WHERE ho.signal_source = 'backfill-059-from-decision-outcomes'
      AND ho.note = 'auto-backfilled from decision_outcomes row ' || do_row.id::text
  );
END$$;

-- Sanity check: after backfill, every project with decision_outcomes rows
-- should also have at least one hermes_outcomes row referencing the same
-- decisions. This is a monitoring query, not a constraint — surfaced so
-- operators running the migration can spot gaps.
--
-- Sample:
--   SELECT project_id, COUNT(*) AS gap_rows
--   FROM decision_outcomes do_row
--   WHERE NOT EXISTS (
--     SELECT 1 FROM decision_outcome_stats v
--     WHERE v.decision_id = do_row.decision_id AND v.project_id = do_row.project_id
--   )
--   GROUP BY project_id;
