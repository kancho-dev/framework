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

## Current V1 Implementation Slice

The repository now includes an initial local-first PostgreSQL implementation under `memory-service/`:

- `package.json` — isolated Node package for the memory-service CLI
- `migrations/001-init.sql` — initial PostgreSQL schema for `sessions`, `messages`, `work_reports`, and `lessons`
- `bin/mem.js` — tiny CLI entrypoint for queries, lessons, and import commands
- `lib/adapters/opencode/import.js` — OpenCode SQLite importer
- `lib/adapters/opencode/read-sqlite.js` — OpenCode SQLite reader
- `lib/adapters/opencode/normalize.js` — OpenCode SQLite normalization
- `.env.example` — database/workspace configuration example
- `SETUP.md` — setup, Docker PostgreSQL, helper scripts, and validation instructions

This slice is intentionally small:
- one storage backend: PostgreSQL
- one interface: CLI
- no UI and no automatic summarization

## CLI Invocation

The default invocation form is:

```bash
node ./bin/mem.js <command>
```

If you want a plain `mem` command from anywhere, two simple options are documented in `SETUP.md`:
- `npm link` from this package directory
- a shell alias pointing at `bin/mem.js`

Both approaches are workspace-specific, so be careful if you keep multiple framework workspaces side by side.

## Adapter Status

The earlier assumption that OpenCode sessions could be imported from JSONL transcript files was incorrect for the real OpenCode environment being targeted here.
OpenCode session, todo, and message data are stored in SQLite, so the adapter is implemented around SQLite extraction.

Current OpenCode adapter behavior:
- reads the OpenCode SQLite database through the local `sqlite3` CLI
- imports `session` rows into framework `sessions`
- reconstructs framework `messages` from `message` plus `part`
- stores only searchable text content from `part.type = text`
- ignores reasoning and step markers by default
- derives one searchable `work_report` per session from `todo` rows when present
- defaults to importing only sessions whose OpenCode `directory` or `project.worktree` falls under `MEMORY_WORKSPACE_ROOT`
- supports `--scope all` for optional broader imports

JSONL-based import is better treated as future work for another adapter, likely Pi.

## Boundary Reminder

The memory service is for search and recall.
It does not replace:
- `ACTIVE-CONTEXT.md`
- task `HANDOFF.md` / `CONTEXT.md`
- `FIXES.md`
- other markdown files that hold current state or policy

## Not In Scope For V1

- automatic summarization
- kanban boards
- ideas database
- bookmarks
- full mission control UI
- platform-specific auth or cron logic
