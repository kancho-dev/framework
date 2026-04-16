# Adapters

The memory service should be fed by adapters, not by one hardcoded platform.

## Adapter Responsibility

Each adapter converts platform-specific session artifacts into the common records:
- messages
- sessions
- work reports
- lessons

## Example Adapters

### OpenCode adapter

Input examples:
- OpenCode SQLite database files
- session tables or message tables inside the OpenCode local store
- todo/work item tables if they are needed for `work_reports`

Current implementation note:
- OpenCode integration reads the local SQLite database instead of transcript files
- `session` maps to framework sessions
- `message` plus `part` reconstruct framework messages
- only `part.type = text` is stored as searchable message content in v1
- reasoning, step markers, synthetic tool-echo text, and other noisy parts are ignored by default
- `todo` rows are used to derive one searchable `work_report` per session when todos exist
- imports default to the current workspace scope via `MEMORY_WORKSPACE_ROOT`, with `--scope all` available for broader import
- the SQLite DB path can be supplied as a CLI argument or preconfigured with `MEMORY_OPENCODE_DB_PATH`
- the SQLite CLI executable can be overridden with `MEMORY_SQLITE3_BIN` when it is not on the default `PATH`

### Pi adapter

Input examples:
- exported chat logs
- JSONL session files
- structured notes
- task outputs

Current implementation note:
- Pi integration reads JSONL session files under a sessions root directory
- the first line is a session header and later lines are event/message records
- searchable messages come from user `text` and assistant-visible `text`
- hidden `thinking`, structured `toolCall`, and `toolResult` content are excluded from searchable messages by default
- session-level provenance such as `cwd`, model changes, thinking-level changes, and observed tool results can be preserved in `source_metadata`
- imports default to workspace scope via Pi `session.cwd` against `MEMORY_WORKSPACE_ROOT`, with `--scope all` available for broader import
- the sessions root can be supplied as a CLI argument or preconfigured with `MEMORY_PI_SESSIONS_ROOT`
- Pi imports currently create `sessions` and `messages`, but not derived `work_reports`

### Manual adapter

Input examples:
- markdown logs
- JSON exports
- copied transcripts

## Adapter Rules

1. Preserve timestamps if available.
2. Preserve source type if available.
3. Strip hidden reasoning and irrelevant tool noise if that data exists.
4. Do not invent structure the source does not contain.
5. Make ingestion idempotent where possible.
