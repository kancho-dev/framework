# Session Browser

A local, read-only browser for AI coding-agent sessions.

Use it to quickly find, skim, and restore past Pi, OpenCode, and Codex coding sessions for the current workspace.

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
SESSION_SOURCES=codex npm start
WORKSPACE_ROOT=/path/to/workspace npm start
PORT=8790 npm start
```

The tool helps you:

- browse sessions by prompt, cwd, origin, source, recency, token pressure, bookmarks, and tags;
- bookmark important sessions and add simple manual tags that persist locally;
- skim conversations, topic anchors, assistant answers, and tool actions;
- copy restore commands back into Pi, OpenCode, or Codex;
- inspect patches, edits, todos, and copyable assistant code blocks.

Everything stays local. The server reads session data and does not modify Pi, OpenCode, or Codex session stores.

## Requirements

- Node.js with ES module support.
- Optional for OpenCode support: the `sqlite3` CLI on `PATH`.

No npm install is needed for the current dependency-free tool.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default: `8787`. |
| `WORKSPACE_ROOT` | Workspace to show sessions for. Default: nearest parent containing `AGENTS.md`, otherwise current directory. |
| `SESSION_SOURCES` | Comma-separated sources. Default: `pi,opencode,codex`. Use `pi`, `opencode`, or `codex` to isolate one source. |
| `PI_SESSION_ROOT` | Pi JSONL session root. |
| `SESSION_ROOT` | Backward-compatible alias for `PI_SESSION_ROOT`. |
| `OPENCODE_DB` | Exact OpenCode SQLite database path. |
| `OPENCODE_DATA_DIR` | OpenCode data directory. Default DB becomes `$OPENCODE_DATA_DIR/opencode.db`. Also used for diff sidecar files. |
| `CODEX_HOME` | Codex state directory. Default: `~/.codex`. |
| `CODEX_SESSION_ROOT` | Codex rollout JSONL root. Default: `$CODEX_HOME/sessions`. |
| `SESSION_BROWSER_OPENCODE_LIMIT` | Maximum OpenCode sessions to list after workspace filtering. Default: `500`. |
| `SESSION_BROWSER_METADATA` | Local JSON sidecar file for bookmarks and tags. Default: `$WORKSPACE_ROOT/.tools-config/session-browser/metadata.json`. |

Default Pi session root:

```text
~/.pi/agent/sessions
```

Default OpenCode database:

```text
~/.local/share/opencode/opencode.db
```

Default Codex session root:

```text
~/.codex/sessions
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

It filters sessions to the configured `WORKSPACE_ROOT` using the OpenCode session directory before applying `SESSION_BROWSER_OPENCODE_LIMIT`.

Restore command copied by the UI:

```bash
opencode --session '<session-id>' '<cwd>'
```

OpenCode support is best-effort and fail-soft. If the DB, `sqlite3`, or expected schema is unavailable, Pi sessions can still load.

### Codex

The Codex adapter reads local rollout JSONL files under `CODEX_SESSION_ROOT` and filters them to the configured `WORKSPACE_ROOT` using recorded cwd metadata.

Restore command copied by the UI:

```bash
codex resume '<session-id>'
```

Codex support is best-effort and fail-soft. It renders user/assistant text and generic tool calls from observed rollout events. `~/.codex/session_index.jsonl` may list only currently indexed sessions, so rollout JSONL files are treated as the browsing source of truth.

## UI Guide

- **Search**: filter by prompt, cwd, name, id, path, or tag.
- **Bookmarked filter**: show only sessions you marked with ★.
- **Tag filter**: show sessions with a selected manual tag; filter dropdowns use the shared capped-height listbox styling.
- **More filters & sort**: expand only when needed for source, work-dir (`cwd`), and sort controls; opened dropdowns use the same shared slick listbox treatment as autocomplete suggestions.
- **Clear**: reset search, filters, source, work-dir, and sort back to defaults.
- **Origin pills**: cards for subdirectory sessions show a compact workspace-relative cwd label; hover for the full cwd. Workspace-root sessions omit the pill to reduce clutter.
- **Session tags**: click a tag pill on a card to filter by that tag.
- **Auto 10s**: enabled by default; refreshes session list and selected detail.
- **Token pressure pill/bar**: visual heaviness signal from recorded token usage; not context-window percentage.
- **Topics rail**: jump between user prompts in the selected session.
- **Show tool calls**: off by default; reveal tool-only/action detail when needed.
- **Bookmark**: mark/unmark the selected session as worth finding again.
- **Tags**: add or remove simple manual tags from the selected session with shared capped-height autocomplete suggestions.
- **Copy restore cmd**: copy the source-specific command to resume a session in the native tool.
- **Parent/child links**: OpenCode parent/child sessions are shown as quick links when available.
- **Patches/todos**: `apply_patch`/patch blocks and `todowrite` arrays are rendered best-effort.
- **Copy prompt**: user messages get a small copy button for reusing prompts in new sessions.
- **Code blocks**: fenced assistant markdown code blocks get a small copy button.
- **Markdown tables**: assistant pipe tables render as scrollable tables and keep horizontal scroll position across auto-refresh.

## Bookmarks And Tags

Bookmarks and tags are an Operator-curated local layer. They do not change Pi JSONL files, the OpenCode SQLite database, or Codex rollout files.

By default the metadata is stored in the workspace-local private tools config directory:

```text
.tools-config/session-browser/metadata.json
```

Override it when needed:

```bash
SESSION_BROWSER_METADATA=/path/to/session-browser-metadata.json npm start
```

The file shape is intentionally simple and private/local. Older metadata files using `labels` are still read as a compatibility alias; run `node tools/session-browser/migrate-metadata.mjs` to rewrite them to canonical `tags`:

```json
{
  "version": 2,
  "sessions": {
    "pi:/abs/path/to/session.jsonl": {
      "bookmarked": true,
      "tags": ["framework", "release"]
    },
    "opencode:session-id": {
      "bookmarked": false,
      "tags": ["research"]
    },
    "codex:session-id": {
      "bookmarked": false,
      "tags": ["codex"]
    }
  }
}
```

To reset bookmarks and tags, stop the server and delete the metadata file. To back them up, copy that file. Treat it as private because tags and session keys can reveal local paths, project names, or work topics.

For existing-workspace upgrades from older metadata paths, use `MIGRATIONS.md` as the source of truth. Explicit `SESSION_BROWSER_METADATA` override paths remain supported.

The first slice is deliberately manual: the tool does not auto-tag sessions and does not expose CLI/API workflows for agents to write tags on your behalf.

Update note for framework agents: when upgrading existing workspaces, follow `MIGRATIONS.md` for metadata-path migration. The tag migration command above is idempotent and creates a timestamped backup before rewriting local private metadata.

## Privacy And Safety

Session transcripts, cwd paths, tool arguments/results, patches, todos, SQLite databases, exports, logs, local bookmark/tag metadata, and local env files can be sensitive.

The tool is designed to be:

- local-only;
- read-only against source session stores;
- dependency-free;
- safe to run without uploading or syncing data.

Do not commit private session data, copied databases, exports, logs, bookmark/tag metadata, `.env` files, or dependency/cache folders.

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
- Bookmark/tag metadata is local-only and manual; no auto-tagging or sync is included.
- No mutation of Pi, OpenCode, or Codex session data is supported.
- OpenCode listing is capped by `SESSION_BROWSER_OPENCODE_LIMIT` after workspace filtering; large-session pagination is not implemented yet.
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
