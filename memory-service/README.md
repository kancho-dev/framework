# Memory Service

Optional searchable memory layer for the framework.

Use this only if file-based context is not enough.

## Purpose

The core framework uses markdown files as the source of truth for active work.

This memory service adds:
- exact historical recall
- cross-session search
- searchable work reports
- searchable lessons

It should support the framework, not replace it.

## Minimum Valuable Scope

Keep only these records in v1:
- `messages`
- `sessions`
- `work_reports`
- `lessons`

## Recommended Queries

- search past discussion of a topic
- show recent session context
- show recent work reports
- search lessons before risky or repeated work

## Recommended Rule

If the answer is needed for current state or policy, write it into markdown.
If the answer is only needed for search and recall, the memory service is enough.

## Suggested Implementation Strategy

1. Pick a local database.
   - SQLite if you want very low setup cost
   - PostgreSQL if you expect higher volume or richer querying
2. Define an ingestion adapter for each agent platform.
3. Expose a small CLI.
4. Keep any web UI optional.

## Not In Scope For V1

- automatic summarization
- kanban boards
- ideas database
- bookmarks
- full mission control UI
- platform-specific auth or cron logic
