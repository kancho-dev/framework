# Session Browser

A local, read-only browser for AI coding-agent sessions.

Use it to quickly find, skim, and restore past Pi, OpenCode, Codex, and Claude Code coding sessions for the current workspace.

Assistant Markdown uses the safe shared renderer documented in [`../shared-web/MARKDOWN.md`](../shared-web/MARKDOWN.md). Session Browser keeps its heading offset and code-copy presentation as scoped adapters.

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

- browse sessions by prompt, cwd, origin, source, recency, latest context load, bookmarks, and tags;
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
| `SESSION_SOURCES` | Comma-separated sources. Default: `pi,opencode,codex,claude-code`. Use a single value such as `pi`, `opencode`, `codex`, or `claude-code` to isolate one source. |
| `PI_SESSION_ROOT` | Pi JSONL session root. |
| `SESSION_ROOT` | Backward-compatible alias for `PI_SESSION_ROOT`. |
| `OPENCODE_DB` | Exact OpenCode SQLite database path. |
| `OPENCODE_DATA_DIR` | OpenCode data directory. Default DB becomes `$OPENCODE_DATA_DIR/opencode.db`. Also used for diff sidecar files. |
| `CODEX_HOME` | Codex state directory. Default: `~/.codex`. |
| `CODEX_SESSION_ROOT` | Codex rollout JSONL root. Default: `$CODEX_HOME/sessions`. |
| `CLAUDE_HOME` | Claude Code state directory. Default: `~/.claude`. |
| `CLAUDE_PROJECTS_ROOT` | Claude Code session JSONL root. Default: `$CLAUDE_HOME/projects`. |
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

### Claude Code

The Claude Code adapter reads local session JSONL files under `CLAUDE_PROJECTS_ROOT` (`~/.claude/projects/<encoded-cwd>/*.jsonl`) and filters them to the configured `WORKSPACE_ROOT` using each session's recorded `cwd` field rather than the lossy encoded directory name.

Sub-agent sessions are included. Claude Code stores them as sidechains at `<parentSessionId>/subagents/agent-<agentId>.jsonl`; the browser lists them with a **child session** badge and links each sub-agent to its parent (and each parent to its sub-agents) through the same parent/child relations UI used for OpenCode.

Restore command copied by the UI for a parent session:

```bash
claude --resume '<session-id>'
```

Sub-agent (sidechain) sessions are read-only in the browser and are not independently resumable, so no restore command is offered for them. Claude Code support is best-effort and fail-soft: it renders user/assistant text, thinking, and generic tool calls/results, and a missing or empty `CLAUDE_PROJECTS_ROOT` never blocks the other sources.

## Writing An Adapter

A new source normalizes into these shapes. This is the contract; everything else about a source is adapter-private.

```ts
type SessionSummary = {
  id: string;
  source: 'pi' | 'opencode' | string;
  path: string;
  cwd?: string;
  name?: string;
  firstPrompt?: string;
  createdAt?: string;
  updatedAt?: string;
  leafId?: string | null;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number; // actual assistant answer messages
  toolMessageCount?: number;     // tool-only/thinking/action turns
  toolCallCount: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; // cumulative lifetime
  contextLoad?: { latest: number | null; preferredCeiling: number }; // latest response; `null` means unknown, not zero
  bookmarkKey?: string;
  bookmarked?: boolean;
  labels?: string[];
};

type SessionDetail = SessionSummary & {
  entries: unknown[];
  activeEntries: unknown[];
  topicAnchors: Array<{
    id: string;
    timestamp?: string;
    title: string;
    depth: 'first-prompt' | 'user-prompt';
  }>;
  parentSession?: SessionSummary | null;
  childSessions?: SessionSummary[];
};
```

Every adapter must be fail-soft: one source failing or timing out must never block the others from listing.

### Adapter implementation notes

Non-obvious constraints found by implementation — the things a change here is likely to get wrong twice.

- **OpenCode records the same per-response usage twice**, on the assistant `message` row and on its `step-finish` `part` rows, so parts contribute only when the message row carries no usage of its own. Latest context must be selected **by usage-row timestamp** in both the list SQL and the shared JS path: a part orphaned from its message row can otherwise override a newer response, and iteration order is not a safe proxy for recency.
- **OpenCode workspace filtering must happen in SQL *before* the listing cap**, or the cap silently applies to recent global sessions instead of relevant workspace ones.
- **Codex `~/.codex/session_index.jsonl` is not the source of truth** — it can omit rollout files. Scan the rollout files themselves.
- **Codex `input_tokens` already includes `cached_input_tokens`**; split them before summing, or cached input is double-counted. `model_context_window` is deliberately unused as a pill denominator, since one static ceiling applies across adapters.
- Token/usage accounting shared with the Tokens / Cost Analyzer lives in `tools/shared-web/opencode-usage.mjs` so both tools report the same totals. Change it in one place.

## UI Guide

- **Search**: filter by prompt, cwd, name, id, path, or tag.
- **Bookmarked filter**: show only sessions you marked with ★.
- **Tag filter**: show sessions with a selected manual tag; filter dropdowns use the shared capped-height listbox styling.
- **More filters & sort**: expand only when needed for source, work-dir (`cwd`), and sort controls; opened dropdowns use the same shared slick listbox treatment as autocomplete suggestions.
- **Clear**: reset search, filters, source, work-dir, and sort back to defaults.
- **Origin pills**: cards for subdirectory sessions show a compact workspace-relative cwd label; hover for the full cwd. Workspace-root sessions omit the pill to reduce clutter.
- **Session tags**: click a tag pill on a card to filter by that tag.
- **Auto 10s**: enabled by default; refreshes session list and selected detail.
- **Context pill/bar**: latest recorded context load (`Xk ctx`) against the tool's static 200k preferred ceiling; this is an operational handoff threshold, not the model's context-window percentage.
- **Topics rail**: jump between user prompts in the selected session.
- **Show tool calls**: off by default; reveal tool-only/action detail when needed.
- **Bookmark**: mark/unmark the selected session as worth finding again.
- **Tags**: add or remove simple manual tags from the selected session with shared capped-height autocomplete suggestions.
- **Copy restore cmd**: copy the source-specific command to resume a session in the native tool.
- **Parent/child links**: OpenCode parent/child sessions and Claude Code parent/sub-agent sessions are shown as quick links when available.
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

For existing-workspace upgrades from older metadata paths, see the metadata-path move in `migrations/v0.14.0.md`, indexed from `MIGRATIONS.md`. Explicit `SESSION_BROWSER_METADATA` override paths remain supported.

The first slice is deliberately manual: the tool does not auto-tag sessions and does not expose CLI/API workflows for agents to write tags on your behalf.

Update note for framework agents: when upgrading existing workspaces, follow `migrations/v0.14.0.md` for metadata-path migration. The tag migration command above is idempotent and creates a timestamped backup before rewriting local private metadata.

## Privacy And Safety

Session transcripts, cwd paths, tool arguments/results, patches, todos, SQLite databases, exports, logs, local bookmark/tag metadata, and local env files can be sensitive.

The tool is designed to be:

- local-only;
- read-only against source session stores;
- dependency-free;
- safe to run without uploading or syncing data.

Do not commit private session data, copied databases, exports, logs, bookmark/tag metadata, `.env` files, or dependency/cache folders.

## Context And Lifetime Usage

The context pill shows the latest completed response's recorded `input + output + cacheRead + cacheWrite` as `Xk ctx`. Its bar uses a static 200k preferred ceiling: green below 100k, yellow from 100k, and red from 150k, saturating at 200k. This is a workspace preference for considering compaction or handoff, not the model's context-window percentage. Sessions without a completed usage record show `ctx ?` rather than zero.

The detail view separately reports cumulative lifetime input, output, cache-read, cache-write, and combined total. Cached input contributes to current context even though its lifetime category remains separate for usage/cost interpretation.

Compaction history is intentionally not inferred or displayed. The latest-context signal directly answers the tool's handoff question without adding adapter-specific compaction semantics.

OpenCode stores the same per-response usage twice — on the assistant `message` row and on that message's `step-finish` `part` rows — so a message's parts are counted only when the message row records no usage of its own. A response's explicit `tokens.total` is authoritative (it also covers `tokens.reasoning`); otherwise the total is derived from `input + output + reasoning + cache.read + cache.write`. Tokens / Cost Analyzer applies the same lifetime-total rule from the shared `tools/shared-web/opencode-usage.mjs` module.

## Limitations

- OpenCode support depends on the local `sqlite3` CLI and current DB schema.
- OpenCode patch/todo rendering is best-effort.
- No remote access, auth, cloud sync, upload, or sharing behavior is included.
- Bookmark/tag metadata is local-only and manual; no auto-tagging or sync is included.
- No mutation of Pi, OpenCode, or Codex session data is supported.
- OpenCode listing is capped by `SESSION_BROWSER_OPENCODE_LIMIT` after workspace filtering; large-session pagination is not implemented yet.
- Latest context load is adapter-normalized from recorded usage and is not an exact model context-window percentage.
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
