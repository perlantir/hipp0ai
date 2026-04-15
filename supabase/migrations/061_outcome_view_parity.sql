-- Migration 061: decision_outcome_stats view — parity fixes (Phase 14 cont.)
--
-- Three changes on the Postgres view defined in migration 058:
--
--   1. Drop Laplace smoothing. The legacy aggregator
--      recomputeOutcomeAggregates() stores raw successes/total on
--      decisions.outcome_success_rate. The view was returning
--      (positive + 1) / (total + 2) — a DIFFERENT number for the same
--      row. At cutover, loadUnifiedOutcomeStats() overrides the column
--      pre-scoring and the visible rank of every decision shifts,
--      with no way to audit whether the move was "correct". Align on
--      raw rate — outcomeMultiplier() already has small-sample
--      dampening via the count so Laplace is redundant here.
--
--   2. Add a 90-day window. Previously every hermes_outcomes row ever
--      written weighed equally in scoring, with no time decay and no
--      way for the system to forget a stale signal. Combined with
--      MIN_OUTCOMES_FOR_EFFECT=1, a single accidental negative
--      reaction permanently dampened a decision. 90 days matches the
--      staleness-tracker horizon elsewhere in the compiler; decisions
--      can be boosted or dampened by recent feedback but old signals
--      fade.
--
--   3. Replace CREATE OR REPLACE VIEW with DROP + CREATE so the column
--      list can change cleanly across replicas.

DROP VIEW IF EXISTS decision_outcome_stats;

CREATE VIEW decision_outcome_stats AS
WITH exploded AS (
  SELECT
    ho.project_id,
    ho.outcome,
    (snippet_elem::text)::uuid AS decision_id
  FROM hermes_outcomes ho,
       LATERAL jsonb_array_elements_text(ho.snippet_ids_json) AS snippet_elem
  WHERE snippet_elem IS NOT NULL
    AND snippet_elem ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    AND ho.created_at > NOW() - INTERVAL '90 days'
)
SELECT
  decision_id,
  project_id,
  COUNT(*) FILTER (WHERE outcome = 'positive') AS positive_count,
  COUNT(*) FILTER (WHERE outcome = 'neutral')  AS neutral_count,
  COUNT(*) FILTER (WHERE outcome = 'negative') AS negative_count,
  COUNT(*) AS total_count,
  -- Raw rate — matches recomputeOutcomeAggregates() semantics. Small
  -- samples are dampened downstream in outcomeMultiplier() via the
  -- count-based ramp, not here.
  CASE WHEN COUNT(*) > 0
       THEN COUNT(*) FILTER (WHERE outcome = 'positive')::FLOAT / COUNT(*)
       ELSE 0.5
  END AS success_rate
FROM exploded
GROUP BY decision_id, project_id;

COMMENT ON VIEW decision_outcome_stats IS
  'Phase 14 (migration 061 parity): raw success rate over a 90-day window. '
  'Matches recomputeOutcomeAggregates() semantics so the legacy column and '
  'the view produce the same number for the same input.';
