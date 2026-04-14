# Query CLI

Provide a tiny CLI, not a product.

## Recommended Commands

```text
mem import-opencode ./path/to/transcript.jsonl
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

### `mem import-opencode ./path/to/transcript.jsonl`

Import one OpenCode JSONL transcript into PostgreSQL.

Current v1 assumptions:
- input is newline-delimited JSON
- it may contain a `session` record plus `message` and optional `work_report` records
- message content may be plain text or arrays of content blocks
- thinking/tool-only blocks are ignored during normalization
