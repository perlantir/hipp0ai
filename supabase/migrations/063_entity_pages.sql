-- Migration 063: Entity pages — people, companies, concepts, tools, sources
--
-- Introduces a set of linked tables for structured entity knowledge:
--
--   entity_pages          — one row per known entity; compiled_truth holds
--                           the distilled markdown; trust_score + tier drive
--                           retrieval ranking.
--
--   entity_timeline_entries — append-only dated events per entity, keyed by
--                             source so provenance is traceable.
--
--   entity_raw_data        — raw API payloads stored separately from
--                            compiled_truth; unique on (entity_id, source) so
--                            a re-fetch replaces rather than duplicates.
--
--   entity_chunks          — hybrid-search chunks (compiled_truth and timeline
--                            entries embedded separately); embedding stored as
--                            TEXT to match the project's existing pattern for
--                            non-pgvector paths; model column records which
--                            embedding model produced the vector.
--
--   entity_decision_links  — many-to-many join between entities and decisions
--                            with a typed relationship.
--
--   entity_outcome_signals — outcome signals propagated to entities from
--                            session feedback (mirrors hermes_outcomes concept
--                            but entity-scoped).

-- ============================================================
-- ENTITY PAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_pages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('person', 'company', 'concept', 'tool', 'source')),
  title          TEXT NOT NULL,
  compiled_truth TEXT,
  trust_score    FLOAT NOT NULL DEFAULT 0.5,
  tier           INTEGER NOT NULL DEFAULT 3 CHECK (tier IN (1, 2, 3)),
  mention_count  INTEGER NOT NULL DEFAULT 0,
  frontmatter    JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_entity_page_project_slug UNIQUE(project_id, slug)
);

-- ============================================================
-- ENTITY TIMELINE ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_timeline_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  source     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ENTITY RAW DATA
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_raw_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_entity_raw_data_source UNIQUE(entity_id, source)
);

-- ============================================================
-- ENTITY CHUNKS (hybrid search)
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  chunk_source TEXT NOT NULL CHECK (chunk_source IN ('compiled_truth', 'timeline')),
  content      TEXT NOT NULL,
  embedding    TEXT,
  model        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_entity_chunk_index UNIQUE(entity_id, chunk_index)
);

-- ============================================================
-- ENTITY <-> DECISION LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_decision_links (
  entity_id   UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  link_type   TEXT NOT NULL CHECK (link_type IN ('affects', 'references', 'superseded_by', 'informed_by')),
  PRIMARY KEY (entity_id, decision_id, link_type)
);

-- ============================================================
-- ENTITY OUTCOME SIGNALS
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_outcome_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('positive', 'negative', 'partial')),
  source       TEXT NOT NULL,
  context      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_entity_pages_project          ON entity_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_entity_pages_type             ON entity_pages(project_id, type);
CREATE INDEX IF NOT EXISTS idx_entity_timeline_entity        ON entity_timeline_entries(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_chunks_entity          ON entity_chunks(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_decision_links_entity  ON entity_decision_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_decision_links_dec     ON entity_decision_links(decision_id);
CREATE INDEX IF NOT EXISTS idx_entity_outcome_signals_entity ON entity_outcome_signals(entity_id);
