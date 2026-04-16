CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.sessions (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  workspace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  session_type TEXT,
  source_path TEXT,
  source_hash TEXT,
  source_metadata JSONB,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, workspace, external_id)
);

CREATE TABLE IF NOT EXISTS memory.messages (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  workspace TEXT NOT NULL,
  session_id BIGINT NOT NULL REFERENCES memory.sessions(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  parent_external_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT,
  source_type TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, workspace, session_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON memory.messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON memory.messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_fts ON memory.messages
  USING GIN (to_tsvector('english', COALESCE(content, '')));

CREATE TABLE IF NOT EXISTS memory.work_reports (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  workspace TEXT NOT NULL,
  session_id BIGINT REFERENCES memory.sessions(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  project TEXT,
  work_item TEXT,
  summary TEXT NOT NULL,
  source_type TEXT,
  source_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, workspace, external_id)
);

CREATE INDEX IF NOT EXISTS idx_work_reports_created_at ON memory.work_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_reports_fts ON memory.work_reports
  USING GIN (to_tsvector('english', summary));

CREATE TABLE IF NOT EXISTS memory.lessons (
  id BIGSERIAL PRIMARY KEY,
  workspace TEXT NOT NULL,
  category TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  related_project TEXT,
  related_work_item TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'cli'
);

CREATE INDEX IF NOT EXISTS idx_lessons_created_at ON memory.lessons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lessons_fts ON memory.lessons
  USING GIN (to_tsvector('english', title || ' ' || description));
