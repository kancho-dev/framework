ALTER TABLE memory.sessions
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;

ALTER TABLE memory.work_reports
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;
