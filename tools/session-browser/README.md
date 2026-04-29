# Session Browser

A local, read-only browser for AI coding-agent sessions.

Use it to quickly find, skim, and restore past Pi and OpenCode coding sessions for the current workspace.

## Quick Start

From a workspace that has this framework cloned as `framework/`:

```bash
cd framework/tools/session-browser
npm start
```

Open:

```text
http://localhost:8787
```

Useful one-liners:

```bash
SESSION_SOURCES=pi npm start
SESSION_SOURCES=opencode npm start
WORKSPACE_ROOT=/path/to/workspace npm start
PORT=8790 npm start
```

The tool helps you:

- browse sessions by prompt, cwd, source, recency, and token pressure;
- skim conversations, topic anchors, assistant answers, and tool actions;
- copy restore commands back into Pi or OpenCode;
- inspect patches, edits, todos, and copyable assistant code blocks.

Everything stays local. The server reads session data and does not modify Pi or OpenCode session stores.

## Requirements

- Node.js with ES module support.
- Optional for OpenCode support: the `sqlite3` CLI on `PATH`.

No npm install is needed for the current dependency-free tool.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default: `8787`. |
| `WORKSPACE_ROOT` | Workspace to show sessions for. Default: nearest parent containing `AGENTS.md`, otherwise current directory. |
| `SESSION_SOURCES` | Comma-separated sources. Default: `pi,opencode`. Use `pi` or `opencode` to isolate one source. |
| `PI_SESSION_ROOT` | Pi JSONL session root. |
| `SESSION_ROOT` | Backward-compatible alias for `PI_SESSION_ROOT`. |
| `OPENCODE_DB` | Exact OpenCode SQLite database path. |
| `OPENCODE_DATA_DIR` | OpenCode data directory. Default DB becomes `$OPENCODE_DATA_DIR/opencode.db`. Also used for diff sidecar files. |

Default Pi session root:

```text
~/.pi/agent/sessions
```

Default OpenCode database:

```text
~/.local/share/opencode/opencode.db
```

## Supported Sources

### Pi

The Pi adapter reads JSONL session files directly and filters them to the configured `WORKSPACE_ROOT` using the session cwd.

Restore command copied by the UI:

```bash
pi --session '<session-jsonl-path>'
```

### OpenCode

The OpenCode adapter reads the local SQLite database through:

```bash
sqlite3 -readonly
```

It filters sessions to the configured `WORKSPACE_ROOT` using the OpenCode session directory/worktree.

Restore command copied by the UI:

```bash
opencode --session '<session-id>' '<cwd>'
```

OpenCode support is best-effort and fail-soft. If the DB, `sqlite3`, or expected schema is unavailable, Pi sessions can still load.

## UI Guide

- **Source filter**: show all sessions, Pi only, or OpenCode only.
- **Sort**: updated newest/oldest or created newest/oldest.
- **Auto 10s**: enabled by default; refreshes session list and selected detail.
- **Token pressure pill/bar**: visual heaviness signal from recorded token usage; not context-window percentage.
- **Topics rail**: jump between user prompts in the selected session.
- **Show tool calls**: off by default; reveal tool-only/action detail when needed.
- **Copy restore cmd**: copy the source-specific command to resume a session in the native tool.
- **Parent/child links**: OpenCode parent/child sessions are shown as quick links when available.
- **Patches/todos**: `apply_patch`/patch blocks and `todowrite` arrays are rendered best-effort.
- **Code blocks**: fenced assistant markdown code blocks get a small copy button.

## Privacy And Safety

Session transcripts, cwd paths, tool arguments/results, patches, todos, SQLite databases, exports, logs, and local env files can be sensitive.

The tool is designed to be:

- local-only;
- read-only against source session stores;
- dependency-free;
- safe to run without uploading or syncing data.

Do not commit private session data, copied databases, exports, logs, `.env` files, or dependency/cache folders.

## Token Pressure, Context, And Cost

The tool intentionally does not estimate exact model context-window percentage or token cost.

Why:

- Pi, OpenCode, and future adapters may record model/usage/cache/context data differently;
- model limits can vary by provider, account, deployment, and native tool interpretation;
- token prices change and are often absent from session data;
- guessed context/cost values can look precise while being wrong.

Instead, the UI shows **token pressure**: the largest observed non-cache-read token usage for a turn, using `input + output + cacheWrite` when available and excluding repeated `cacheRead` tokens. This preserves a useful visual signal for light vs heavy sessions without pretending to know exact context usage.

## Limitations

- OpenCode support depends on the local `sqlite3` CLI and current DB schema.
- OpenCode patch/todo rendering is best-effort.
- No remote access, auth, cloud sync, upload, or sharing behavior is included.
- No mutation of Pi or OpenCode session data is supported.
- Large-session pagination is not implemented yet.
- Token pressure is a triage signal, not exact context percentage.
- Cost is omitted unless a future adapter can provide trustworthy source-derived values.

## Troubleshooting

### OpenCode unavailable

Check:

```bash
command -v sqlite3
ls ~/.local/share/opencode/opencode.db
```

Or point the tool explicitly:

```bash
OPENCODE_DB=/path/to/opencode.db npm start
```

### Sessions missing

Check that `WORKSPACE_ROOT` matches the workspace cwd stored in your sessions:

```bash
WORKSPACE_ROOT=/path/to/workspace npm start
```

Use source isolation while debugging:

```bash
SESSION_SOURCES=pi npm start
SESSION_SOURCES=opencode npm start
```

### Port already in use

```bash
PORT=8790 npm start
```
