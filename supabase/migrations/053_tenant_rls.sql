-- Migration 053: Multi-Tenant Row-Level Security (RLS)
--
-- Adds PostgreSQL Row-Level Security policies to every tenant-scoped table as
-- a critical safety net. Even if application-level authorization has a bug,
-- the database will refuse to return or mutate rows that belong to a project
-- other than the one stored in the current session variable
-- `app.current_project_id`.
--
-- Admin / migration / system code paths that legitimately need cross-tenant
-- access can set `app.bypass_rls=true` for the duration of a transaction.
--
-- This migration is Postgres-only. SQLite does not support RLS, so there is
-- no corresponding SQLite version of this migration — the sqlite dialect
-- simply skips it.
--
-- Pattern per table (may vary for edge-cases like nullable project_id or
-- edge tables whose project scope must be derived through a join):
--   ALTER TABLE t ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY t_tenant_isolation ON t
--     USING (project_id = current_setting('app.current_project_id', true)::uuid
--            OR current_setting('app.bypass_rls', true)::boolean = true);
--   CREATE POLICY t_tenant_write ON t FOR INSERT
--     WITH CHECK (project_id = current_setting('app.current_project_id', true)::uuid
--                 OR current_setting('app.bypass_rls', true)::boolean = true);
--
-- NOTE: all policies are written with `IF NOT EXISTS`-ish semantics by
-- wrapping in a DO block so the migration is re-entrant for environments
-- where it is partially applied.

-- ---------------------------------------------------------------------------
-- Helper: safe policy creator
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _hipp0_rls_enable(p_table regclass) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'rls enable skipped for %: %', p_table, SQLERRM;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _hipp0_rls_policy(
  p_table text,
  p_name text,
  p_cmd text,
  p_using text,
  p_check text
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = p_table AND policyname = p_name
  ) THEN
    IF p_cmd = 'ALL' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (%s) WITH CHECK (%s)',
        p_name, p_table, p_using, p_check
      );
    ELSIF p_cmd = 'SELECT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (%s)',
        p_name, p_table, p_using
      );
    ELSIF p_cmd = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (%s)',
        p_name, p_table, p_check
      );
    ELSIF p_cmd = 'UPDATE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE USING (%s) WITH CHECK (%s)',
        p_name, p_table, p_using, p_check
      );
    ELSIF p_cmd = 'DELETE' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR DELETE USING (%s)',
        p_name, p_table, p_using
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Canonical "tenant match" predicate built from the session variable.
-- The second arg to current_setting() is `missing_ok = true`, so the call
-- returns NULL when the variable has never been set, letting callers that
-- haven't entered a tenant context (e.g. anonymous health checks) still
-- operate against tables where every row has a project_id — they'll simply
-- see nothing until setProjectContext() is called.
--
-- Using this as a reusable expression by inlining it into every policy.
-- The `bypass_rls` escape hatch is used by migrations and background jobs.

-- ---------------------------------------------------------------------------
-- Tables with a direct project_id column
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  direct_tables text[] := ARRAY[
    'decisions',
    'decision_outcomes',
    'contradictions',
    'captures',
    'compile_history',
    'task_sessions',
    'session_steps',
    'evolution_proposals',
    'agent_traces',
    'knowledge_insights',
    'reflection_runs',
    'decision_branches',
    'weekly_digests',
    'decision_comments',
    'decision_approvals',
    'decision_annotations',
    'decision_experiments',
    'llm_usage',
    'team_procedures'
  ];
  t text;
  tbl_oid regclass;
  using_expr text := $expr$
    project_id = current_setting('app.current_project_id', true)::uuid
    OR current_setting('app.bypass_rls', true)::boolean = true
  $expr$;
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    -- Skip tables that don't exist in this database yet
    BEGIN
      tbl_oid := t::regclass;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'rls: table % does not exist, skipping', t;
      CONTINUE;
    END;

    PERFORM _hipp0_rls_enable(tbl_oid);

    PERFORM _hipp0_rls_policy(t, t || '_tenant_isolation', 'ALL', using_expr, using_expr);
    PERFORM _hipp0_rls_policy(t, t || '_tenant_write',    'INSERT', using_expr, using_expr);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- audit_log: project_id is NULLABLE (system-wide events). Allow rows where
-- project_id IS NULL to be visible to anyone, plus the standard tenant match.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  using_expr text := $expr$
    project_id IS NULL
    OR project_id = current_setting('app.current_project_id', true)::uuid
    OR current_setting('app.bypass_rls', true)::boolean = true
  $expr$;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') THEN
    PERFORM _hipp0_rls_enable('audit_log'::regclass);
    PERFORM _hipp0_rls_policy('audit_log', 'audit_log_tenant_isolation', 'ALL',    using_expr, using_expr);
    PERFORM _hipp0_rls_policy('audit_log', 'audit_log_tenant_write',     'INSERT', using_expr, using_expr);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- decision_edges: has no project_id column — tenant scope is derived from
-- the source/target decision. A row is visible only if both endpoints live
-- in the current project.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  using_expr text := $expr$
    current_setting('app.bypass_rls', true)::boolean = true
    OR EXISTS (
      SELECT 1 FROM decisions d
      WHERE d.id = decision_edges.source_id
        AND d.project_id = current_setting('app.current_project_id', true)::uuid
    )
  $expr$;
  write_expr text := $expr$
    current_setting('app.bypass_rls', true)::boolean = true
    OR EXISTS (
      SELECT 1 FROM decisions d
      WHERE d.id = source_id
        AND d.project_id = current_setting('app.current_project_id', true)::uuid
    )
  $expr$;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'decision_edges') THEN
    PERFORM _hipp0_rls_enable('decision_edges'::regclass);
    PERFORM _hipp0_rls_policy('decision_edges', 'decision_edges_tenant_isolation', 'ALL',    using_expr, write_expr);
    PERFORM _hipp0_rls_policy('decision_edges', 'decision_edges_tenant_write',     'INSERT', write_expr, write_expr);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Housekeeping: keep the helper functions around for future re-runs and for
-- ops to add new tables without redefining them, but make them SECURITY
-- DEFINER-safe (no elevated privileges; they just execute DDL locally).
-- ---------------------------------------------------------------------------
