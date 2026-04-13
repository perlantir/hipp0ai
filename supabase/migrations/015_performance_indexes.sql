-- Phase 7: Performance indexes
-- GIN, HNSW, B-tree, and composite indexes for query performance

-- B-tree indexes on decisions
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions (created_at);
CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions (project_id);

-- GIN indexes on array/jsonb columns
CREATE INDEX IF NOT EXISTS idx_decisions_tags_gin ON decisions USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_decisions_affects_gin ON decisions USING GIN (affects);

-- HNSW index on embedding column for fast vector similarity search
-- Only created if pgvector extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_decisions_embedding_hnsw ON decisions USING hnsw (embedding vector_cosine_ops)';
  END IF;
END $$;

-- B-tree on audit_log.created_at (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at)';
  END IF;
END $$;

-- Composite index on compile_history for project+agent+time queries
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'compile_history') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_compile_history_project_agent_time ON compile_history (project_id, agent_id, compiled_at)';
  END IF;
END $$;
