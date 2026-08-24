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
- bookmark important sessions, add simple manual tags, and save prompt-led topics locally;
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
- **Curation filters**: use the gold-star **Bookmarked** and **Has saved topics** filters independently or together; combined filters use AND semantics.
- **Tag filter**: show sessions with a selected manual tag; it sits with **Clear** below the curation filters and uses the shared capped-height listbox styling.
- **More filters & sort**: expand only when needed for source, work-dir (`cwd`), and sort controls; opened dropdowns use the same shared slick listbox treatment as autocomplete suggestions.
- **Clear**: reset search, filters, source, work-dir, and sort back to defaults.
- **Origin pills**: cards for subdirectory sessions show a compact workspace-relative cwd label; hover for the full cwd. Workspace-root sessions omit the pill to reduce clutter.
- **Session tags**: click a tag pill on a card to filter by that tag.
- **Auto 10s**: enabled by default; refreshes session list and selected detail.
- **Deferred detail refresh**: selecting reader text pauses detail refresh and shows a sticky warning; choose **Refresh now** to clear the selection and apply the waiting refresh.
- **Context pill/bar**: latest recorded context load (`Xk ctx`) against the tool's static 200k preferred ceiling; this is an operational handoff threshold, not the model's context-window percentage.
- **Topics rail**: jump between user prompts; saved topics have a leading gold ★, topics with notes also show a note icon, and clicking the link only navigates. **Saved only** appears when the selected session has saved topics. The first prompt has no separate star.
- **Show tool calls**: off by default; reveal tool-only/action detail when needed.
- **Bookmark**: manually mark/unmark the selected session as worth finding again. This remains independent from saved topics.
- **Saved-topic count**: session cards with saved topics show an `N saved topics` relation-style pill; adding or removing topics never changes the manual session bookmark.
- **Tags**: add or remove simple manual tags from the selected session with shared capped-height autocomplete suggestions.
- **Copy restore cmd**: copy the source-specific command to resume a session in the native tool.
- **Parent/child links**: OpenCode parent/child sessions and Claude Code parent/sub-agent sessions are shown as quick links when available.
- **Patches/todos**: `apply_patch`/patch blocks and `todowrite` arrays are rendered best-effort.
- **Prompt actions**: each user prompt ends with a thin action row containing labeled **Copy** and **Save** / **Edit saved** controls. Save/Edit opens the local saved-topic dialog.
- **Code blocks**: fenced assistant markdown code blocks get a small copy button.
- **Markdown tables**: assistant pipe tables render as scrollable tables and keep horizontal scroll position across auto-refresh.

## Archived Machines And Shared Manifests

Standalone Session Browser keeps its backward-compatible workspace-local machine configuration at:

```text
.tools-config/session-browser/machines.json
```

That version-1 file combines immutable machine inventory (`id`, `roots`, optional `artifacts` and `originalRoots`) with the workspace's `pathMap`. Relative archive roots resolve against the machine-config directory. Mapping `from` paths must be absolute; `to` paths resolve inside the current workspace. Archive sources are read-only and session keys use `<source>@<machineId>:<ref>`.

Tool Orchestrator can instead reuse one physical archive and inventory across several workspaces. It supplies one shared manifest plus each workspace's explicit bindings to separate Session Browser handlers. In shared mode:

- the manifest contains machine facts but no `pathMap`;
- only explicitly bound machines are visible to that workspace;
- nested workspaces may deliberately overlap through separate bindings;
- handlers keep independent metadata paths, read guards, scan keys, and immutable-source memos;
- workspace-local `machines.json` is ignored rather than merged, with an informational `local-config-ignored` diagnostic;
- missing or malformed shared inventory fails soft with `legacy-config` diagnostics and never disables live sessions.

See the Tool Orchestrator README for the shared configuration shape and migration procedure. Request parameters cannot add archive roots or bindings. Duplicate machine IDs and duplicate bindings are disabled rather than resolved by precedence; exact duplicate mappings are deduplicated, conflicting exact mappings are disabled, and valid nested mappings use longest-prefix matching.

## Multi-Workspace Metadata Archives

The archive builder can preserve every configured Tool Orchestrator workspace's private Session Browser annotations alongside the machine's immutable sessions:

```bash
node tools/session-browser/build-archive.mjs old-linux \
  --workspaces /path/to/.tools-config/tool-orchestrator/workspaces.json
```

The workspace config must declare `sessionArchiveManifestPath`. Each workspace is exported by stable `id`, `root`, and its explicit `sessionMetadataPath`; the builder never discovers metadata files or falls back to the Session Browser process default. An omitted or missing sidecar produces a canonical empty snapshot marked `absentSource`. The whole machine archive is staged and atomically published, so a metadata read/write failure prevents publication. Re-export requires rebuilding the whole machine archive under the existing `--overwrite` gate.

The published machine contains `metadata/bundle.json` and one byte-preserving snapshot under `metadata/workspaces/<workspace-id>/metadata.json`. The bundle records machine/workspace identity, old roots, source provenance, checksums, byte counts, and export time. These files are immutable archive artifacts; imports never edit them.

Import is explicit and dry-run-first. The machine must be registered in the current shared manifest and each destination must have an explicit archive binding and `sessionMetadataPath`:

```bash
node tools/session-browser/import-archive-metadata.mjs \
  --bundle /path/to/archive/old-linux/metadata/bundle.json \
  --workspaces /path/to/.tools-config/tool-orchestrator/workspaces.json

# Machine-readable report
# (same validation, routing, ownership, conflict, and count details)
... --json

# Apply after reviewing the dry run
... --apply
```

Routing uses an explicit override first, exact stable workspace-ID equality second, and otherwise leaves the snapshot `unbound`. It never infers from labels, folder names, roots, path suffixes, or Global containment. Connect a renamed or history-only destination explicitly:

```bash
... --bind retired-client=client-history
```

A destination may receive only one archived workspace per invocation. Import verifies bundle containment/checksums, archived session existence and original `cwd` ownership, binding translation, destination containment, and protection of sessions that still resolve in live stores. Global visibility does not transfer metadata ownership: Framework's snapshot imports only into Framework, while Global receives only its own snapshot.

Dry-run and `--json` output classify each snapshot as `bound`, `unbound`, `invalid`, `already-imported`, or `failed`; they include provenance drift, source/destination checksums, canonicalization, eligible and unmatched keys, saved-topic conflicts with archived values, expected counts, diagnostics, and summary totals. A changed shared-manifest checksum is reported as provenance drift but does not invalidate an otherwise current registration/binding.

`--apply` rechecks the plan and snapshot, compares destination state before rename, backs up an existing changed sidecar, writes atomically, validates the result, and then records success in the private external ledger (default `.tools-config/session-browser/archive-metadata-imports.json` relative to the Tool Orchestrator config). An absent destination is created without a meaningless backup. Reimporting the same machine/workspace/snapshot/destination tuple is a no-op. Importing the same archived workspace into another destination is blocked unless `--allow-rebind` explicitly acknowledges the fan-out risk; old ledger records remain immutable.

Imports are fail-soft per workspace. A ledger-write failure occurs after the sidecar publication by design and is reported as failed; the timestamped backup remains available, and rerunning safely re-merges the additive metadata before retrying the ledger write. Bookmarks merge by OR, tags by union, and saved topics by entry ID; current saved-topic values win destructive conflicts while archived values remain in the report.

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

The file shape is intentionally simple and private/local. Saved topics are keyed by the source topic-entry ID and may contain private prompt excerpts, titles, and notes. Older metadata files using `labels` are still read as a compatibility alias; run `node tools/session-browser/migrate-metadata.mjs` to rewrite them to canonical `tags` while preserving saved topics:

```json
{
  "version": 3,
  "sessions": {
    "pi:/abs/path/to/session.jsonl": {
      "bookmarked": true,
      "tags": ["framework", "release"],
      "savedTopics": {
        "user-message-id": {
          "title": "Why browse-first beats transcript indexing",
          "note": "Useful product decision",
          "prompt": "Should Session Browser become search-first?",
          "timestamp": "2026-08-12T15:35:00.000Z"
        }
      }
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

To move existing annotations onto one configured archived machine's session keys, run a dry run first. The remap needs that machine's `originalRoots` — the live session roots it had before retirement — which `build-archive.mjs` emits in the config block it prints, so no manual entry is needed for archives built by that script:

```bash
node tools/session-browser/migrate-metadata.mjs --remap-machine old-linux
```

Use `--machines /path/to/machines.json` to inspect a non-default machine config. The command rewrites only keys that resolve to files or IDs in that archive and skips sessions that still resolve in current live stores. It preserves unmatched keys and merges existing archived metadata additively: bookmarks use OR, tags use set union, and saved topics merge by entry ID. Current saved-topic values win conflicts, which are reported. Review the output, then add `--apply` to write; apply creates a timestamped metadata backup first. Reapplying a completed remap is a no-op.

To reset bookmarks, tags, and saved topics, stop the server and delete the metadata file. To back them up, copy that file. Treat it as private because tags, saved titles/notes/prompt excerpts, and session keys can reveal local paths, project names, or work topics.

For existing-workspace upgrades from older metadata paths, see the metadata-path move in `migrations/v0.14.0.md`, indexed from `MIGRATIONS.md`. Explicit `SESSION_BROWSER_METADATA` override paths remain supported.

Saved topics intentionally remain attached to their source sessions: there is no separate global Saved collection and session text search does not search saved-topic titles, notes, or prompt excerpts. If a saved entry ID no longer resolves to a displayed prompt, its private metadata remains counted but is not rendered and Session Browser never guesses a replacement. This rare fail-soft case is documented as a risk; recovery can be added if real use demonstrates a need.

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
