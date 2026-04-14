-- Migration 039 (sqlite): decision_outcome_stats view — parity with Postgres
--
-- The Postgres side got this view in supabase/migrations/058 (and a
-- parity fix in 061). SQLite lagged behind, so loadUnifiedOutcomeStats()
-- short-circuited on SQLite and the whole Phase 14 code path was
-- unreachable in CI. That let the double-counting bug (see commit
-- fixing Phase 14 double-multiply) hide from the test suite for months.
--
-- Uses json_each for the snippet_ids_json array expansion — the SQLite
-- equivalent of Postgres LATERAL jsonb_array_elements_text. Decision
-- ids are loosely validated against the UUID shape; non-UUID entries
-- are dropped to match the Postgres view.
--
-- Matches the Postgres 061 definition: raw rate (no Laplace), 90-day
-- window. Small-sample dampening is applied downstream by
-- outcomeMultiplier().

DROP VIEW IF EXISTS decision_outcome_stats;

CREATE VIEW decision_outcome_stats AS
WITH exploded AS (
  SELECT
    ho.project_id,
    ho.outcome,
    json_each.value AS decision_id
  FROM hermes_outcomes ho, json_each(ho.snippet_ids_json)
  WHERE json_valid(ho.snippet_ids_json)
    AND json_each.value IS NOT NULL
    AND length(json_each.value) = 36
    AND substr(json_each.value, 9, 1) = '-'
    AND substr(json_each.value, 14, 1) = '-'
    AND substr(json_each.value, 19, 1) = '-'
    AND substr(json_each.value, 24, 1) = '-'
    AND ho.created_at > datetime('now', '-90 days')
)
SELECT
  decision_id,
  project_id,
  SUM(CASE WHEN outcome = 'positive' THEN 1 ELSE 0 END) AS positive_count,
  SUM(CASE WHEN outcome = 'neutral'  THEN 1 ELSE 0 END) AS neutral_count,
  SUM(CASE WHEN outcome = 'negative' THEN 1 ELSE 0 END) AS negative_count,
  COUNT(*) AS total_count,
  CASE WHEN COUNT(*) > 0
       THEN CAST(SUM(CASE WHEN outcome = 'positive' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
       ELSE 0.5
  END AS success_rate
FROM exploded
GROUP BY decision_id, project_id;
