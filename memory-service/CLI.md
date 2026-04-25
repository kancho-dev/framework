# Query CLI

Provide a tiny CLI, not a product.

## Recommended Commands

```text
mem import-opencode-sqlite [/path/to/opencode.db]
mem import-opencode-sqlite --scope all
mem import-pi-jsonl [/path/to/pi/sessions]
mem import-pi-jsonl --scope all
mem search "query"
mem recent 20
mem reports 10
mem sessions
mem lessons search "query"
mem lessons add "title" --desc "..."
```

## Minimum Behaviors

### `mem search "query"`

Search message content across sessions.

### `mem recent 20`

Show recent human and assistant messages for fast catch-up.

### `mem sessions`

Show recent sessions with a small trace hint from adapter metadata, such as Pi `cwd` or OpenCode directory/worktree.

### `mem reports 10`

Show recent delegated or recurring work summaries.
The current output includes a small trace hint from adapter metadata, such as OpenCode todo counts.

### `mem lessons search "query"`

Search mistakes, gotchas, and durable fixes before risky work.

### `mem lessons add "title" --desc "..."`

Add a lesson after solving a meaningful bug or discovering a repeated failure mode.

### `mem import-opencode-sqlite [/path/to/opencode.db]`

Import OpenCode sessions from the local SQLite database into PostgreSQL.
The path can be passed directly or supplied through `MEMORY_OPENCODE_DB_PATH`.

Default behavior:
- only imports sessions related to the current framework workspace
- matching is based on OpenCode `session.directory` or `project.worktree` being under `MEMORY_WORKSPACE_ROOT`
- reports how many sessions were scanned, in scope, inserted, updated, or unchanged
- reports how many messages and derived work reports were inserted, updated, or unchanged

### `mem import-opencode-sqlite --scope all`

Import all OpenCode sessions found in the SQLite database, not just the current workspace subset.
This works with an explicit path or a configured `MEMORY_OPENCODE_DB_PATH`.

### `mem import-pi-jsonl [/path/to/pi/sessions]`

Import Pi sessions from the local JSONL session store.
The root can be passed directly or supplied through `MEMORY_PI_SESSIONS_ROOT`.

Default behavior:
- scans `.jsonl` session files under the given root recursively
- only imports sessions whose Pi `session.cwd` is under `MEMORY_WORKSPACE_ROOT`
- stores searchable user text and final assistant text
- excludes hidden `thinking`, structured `toolCall`, and `toolResult` content from searchable messages by default
- preserves session/tool provenance in `source_metadata`
- currently does not derive `work_reports`

### `mem import-pi-jsonl --scope all`

Import all Pi sessions found under the configured JSONL root, not just the current workspace subset.

## Adapter Note

The OpenCode adapter is SQLite-backed, not JSONL-backed.
For OpenCode, the importer reconstructs framework messages from `message` + `part` tables and derives searchable work reports from `todo` rows.
The Pi adapter is JSONL-backed and imports sessions/messages from local Pi session files, but does not derive work reports yet.
