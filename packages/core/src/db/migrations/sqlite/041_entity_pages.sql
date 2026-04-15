-- Migration 041 (sqlite): Entity pages -- people, companies, concepts, tools, sources
--
-- SQLite edition of supabase/migrations/063_entity_pages.sql.
--
-- Mapping notes (PostgreSQL -> SQLite):
--   UUID PRIMARY KEY DEFAULT gen_random_uuid() -> TEXT PRIMARY KEY (app-generated)
--   UUID NOT NULL REFERENCES ...               -> TEXT NOT NULL REFERENCES ...
--   TIMESTAMPTZ NOT NULL DEFAULT NOW()         -> TEXT NOT NULL DEFAULT (datetime('now'))
--   DATE NOT NULL DEFAULT CURRENT_DATE         -> TEXT NOT NULL DEFAULT (date('now'))
--   JSONB NOT NULL DEFAULT '{}'                -> TEXT NOT NULL DEFAULT '{}'
--   FLOAT                                      -> REAL
--   PRIMARY KEY (a, b, c)                      -> same (SQLite supports composite PKs)
--   INSERT OR IGNORE                           -> SQLite-native

-- ============================================================
-- ENTITY PAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_pages (
  id             TEXT NOT NULL PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('person', 'company', 'concept', 'tool', 'source')),
  title          TEXT NOT NULL,
  compiled_truth TEXT,
  trust_score    REAL NOT NULL DEFAULT 0.5,
  tier           INTEGER NOT NULL DEFAULT 3 CHECK (tier IN (1, 2, 3)),
  mention_count  INTEGER NOT NULL DEFAULT 0,
  frontmatter    TEXT NOT NULL DEFAULT '{}',
  content_hash   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_entity_page_project_slug UNIQUE(project_id, slug)
);

-- ============================================================
-- ENTITY TIMELINE ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_timeline_entries (
  id         TEXT NOT NULL PRIMARY KEY,
  entity_id  TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  date       TEXT NOT NULL DEFAULT (date('now')),
  source     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- ENTITY RAW DATA
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_raw_data (
  id         TEXT NOT NULL PRIMARY KEY,
  entity_id  TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_entity_raw_data_source UNIQUE(entity_id, source)
);

-- ============================================================
-- ENTITY CHUNKS (hybrid search)
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_chunks (
  id           TEXT NOT NULL PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  chunk_index  INTEGER NOT NULL,
  chunk_source TEXT NOT NULL CHECK (chunk_source IN ('compiled_truth', 'timeline')),
  content      TEXT NOT NULL,
  embedding    TEXT,
  model        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_entity_chunk_index UNIQUE(entity_id, chunk_index)
);

-- ============================================================
-- ENTITY <-> DECISION LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_decision_links (
  entity_id   TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  link_type   TEXT NOT NULL CHECK (link_type IN ('affects', 'references', 'superseded_by', 'informed_by')),
  PRIMARY KEY (entity_id, decision_id, link_type)
);

-- ============================================================
-- ENTITY OUTCOME SIGNALS
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_outcome_signals (
  id           TEXT NOT NULL PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('positive', 'negative', 'partial')),
  source       TEXT NOT NULL,
  context      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
