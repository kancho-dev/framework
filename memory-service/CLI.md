# Query CLI

Provide a tiny CLI, not a product.

## Recommended Commands

```text
mem import-opencode-sqlite /path/to/opencode.db
mem import-opencode-sqlite /path/to/opencode.db --scope all
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

### `mem reports 10`

Show recent delegated or recurring work summaries.

### `mem lessons search "query"`

Search mistakes, gotchas, and durable fixes before risky work.

### `mem lessons add "title" --desc "..."`

Add a lesson after solving a meaningful bug or discovering a repeated failure mode.

### `mem import-opencode-sqlite /path/to/opencode.db`

Import OpenCode sessions from the local SQLite database into PostgreSQL.

Default behavior:
- only imports sessions related to the current framework workspace
- matching is based on OpenCode `session.directory` or `project.worktree` being under `MEMORY_WORKSPACE_ROOT`
- reports how many sessions were scanned, in scope, inserted, updated, or unchanged
- reports how many messages and derived work reports were newly inserted vs already present

### `mem import-opencode-sqlite /path/to/opencode.db --scope all`

Import all OpenCode sessions found in the SQLite database, not just the current workspace subset.

## Adapter Note

The OpenCode adapter is SQLite-backed, not JSONL-backed.
For OpenCode, the importer reconstructs framework messages from `message` + `part` tables and derives searchable work reports from `todo` rows.
JSONL/session-file import is reserved as a likely future path for a Pi adapter.
