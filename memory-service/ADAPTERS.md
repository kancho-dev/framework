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
- reasoning, step markers, and other noisy parts are ignored by default
- `todo` rows are used to derive one searchable `work_report` per session when todos exist
- imports default to the current workspace scope via `MEMORY_WORKSPACE_ROOT`, with `--scope all` available for broader import

### Pi adapter

Input examples:
- exported chat logs
- JSONL session files
- structured notes
- task outputs

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
