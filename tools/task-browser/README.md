# Task Browser

A local browser for framework tracked tasks across workspace projects.

Use it to scan `projects/*/work/*/TASK.md`, initialize task-browser-owned metadata, and browse tasks by status, priority, type, tags, relationships, and resume files.

## Quick Start

From a workspace that has this framework cloned as `framework/`:

```bash
cd framework/tools/task-browser
npm start
```

Open:

```text
http://localhost:8788
```

Useful one-liners:

```bash
WORKSPACE_ROOT=/path/to/workspace npm start
TASK_BROWSER_METADATA=/path/to/tasks.json npm start
PORT=8791 npm start
```

No npm install is needed for the current dependency-free tool.

## What It Shows

- tracked tasks discovered from `projects/*/work/*/TASK.md`;
- display IDs such as `#1`, `#2`, `#3`;
- kanban-lite status columns for `planned`, `active`, `blocked`, `review`, `paused`, and `done`;
- `done` and `paused` hidden by default;
- project-colored card pills with stable colors derived from project names;
- auto-refresh every 10 seconds by default, plus manual Refresh;
- search by display ID, project/slug/key, title, and tags;
- project and priority filters;
- task detail drawer with Purpose, Next steps, Run timeline, Current state, Success/Acceptance, Resume files, Context, and Metadata history; Next steps are read from `HANDOFF.md` `## Next Action` with `## Next Steps` fallback;
- editable status, priority, type, tags, and optional positive-integer order metadata;
- relationship metadata (`blockedBy`, derived `blocks`, `parent`, `children`, `related`) when present, with links to known tasks;
- cross-column drag/drop to change task status;
- a copyable generic task-pickup prompt with subtle hover/focus preview.

## Sorting

Task Browser sorts cards deterministically in the frontend.

For non-`done` columns:

1. optional positive-integer `order` metadata, ascending;
2. priority: `urgent`, `high`, `normal`, `low`;
3. latest run timestamp, newest first, with `HANDOFF.md` mtime fallback when no runs exist;
4. display ID number, descending;
5. task key fallback.

For `done`:

1. tasks with run logs before tasks without run logs;
2. latest run timestamp, newest first;
3. display ID number, descending;
4. task key fallback.

## Metadata

Task Browser stores workflow metadata in a private workspace-level JSON file by default:

```text
.tools-config/task-browser/tasks.json
```

The tool creates or updates this file when `/api/tasks` is loaded. Existing display IDs are preserved; newly discovered tasks get the next number.

Example shape:

```json
{
  "version": 1,
  "nextDisplayNumber": 4,
  "tasks": {
    "agent-framework/task-browser-slc": {
      "displayId": "#3",
      "project": "agent-framework",
      "slug": "task-browser-slc",
      "path": "projects/agent-framework/work/task-browser-slc",
      "status": "active",
      "priority": "high",
      "type": "implementation",
      "blockedBy": [],
      "parent": null,
      "children": [],
      "related": [],
      "tags": ["task-browser"],
      "order": null
    }
  }
}
```

Task Browser metadata owns UI/workflow fields: `displayId`, `status`, `priority`, `type`, `blockedBy`, `parent`, `children`, `related`, `tags`, and optional positive-integer `order`.

Framework task files remain the source of truth for purpose, scope, acceptance criteria, narrative handoff/current state, stable context, and run evidence.

## Metadata History

Task Browser writes an append-only local JSONL history for durable task-browser metadata changes by default:

```text
.tools-config/task-browser/task-history.jsonl
```

Each event records the task key/display ID, timestamp, source, best-effort provenance, and before/after values for changed durable metadata fields: `status`, `priority`, `type`, `tags`, `order`, `parent`, `children`, `blockedBy`, and `related`. Identity/discovery refresh fields such as `displayId`, `project`, `slug`, `path`, and `missing` are not logged as action history.

Browser edits and drag/drop writes default to `actor: "operator"`, `source: "browser"`, and null role/session fields. CLI writes default to `actor: "agent"`, `source: "metadata-cli"`, and null role/session fields unless explicitly provided. This is provenance for local handoff, not authentication or a compliance-grade audit trail.

No-op writes where normalized before/after metadata values are identical do not append events. Safe deletion/retention is simple: stop the server/CLI if active, then delete or archive `.tools-config/task-browser/task-history.jsonl`; current board state remains in `.tools-config/task-browser/tasks.json`.

## Editing And Drag/Drop

The detail drawer can edit common metadata fields directly:

- status, priority, and type through compact pill selects;
- board filter selects through shared capped-height listbox styling;
- tags through add/remove controls with shared capped-height autocomplete suggestions from existing task tags;
- optional order through a small numeric input.

Edits call the local `PATCH /api/task-metadata` endpoint and write only task-browser metadata. They do not silently edit `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, or run logs.

Dragging a card to another status column changes only that task's task-browser metadata `status`. The target column is highlighted while dragging. Same-column drag reordering is deferred; a future implementation should show a clear between-card insertion target and update only the minimal `order` values needed.

## Relationships

When metadata includes `blockedBy`, `parent`, `children`, or `related`, the detail header shows compact relationship pills grouped by relation type. Known tasks are shown by display ID (for example `#32`) and open that task in the detail drawer. The drawer also derives a read-only `blocks` view from other tasks that list the current task in `blockedBy`.

Relationship edits use existing task references with shared capped-height autocomplete and store canonical task keys. `parent` and `children` are reciprocal: setting a parent adds the child to the parent, adding/removing children updates each child's parent, moving a child removes it from the old parent, and cycles/self-parenting are rejected. `related` is symmetric, so adding or removing a related task updates both tasks. `blockedBy` remains the stored directional source of truth; use the derived `blocks` view to see tasks this task is blocking.

## Metadata CLI

Agents must use the dependency-free CLI for non-interactive metadata updates:

```bash
node tools/task-browser/metadata-cli.mjs list --status active
node tools/task-browser/metadata-cli.mjs get '#32'
node tools/task-browser/metadata-cli.mjs key '#32'
node tools/task-browser/metadata-cli.mjs init agent-framework/task-browser-metadata-guidance-rules --status planned --priority high --type documentation
node tools/task-browser/metadata-cli.mjs set '#32' --status review --priority high --tags task-browser,metadata-guidance
node tools/task-browser/metadata-cli.mjs set '#32' --status review --role Builder --session-tool pi --session-id pi-session-id
node tools/task-browser/metadata-cli.mjs history '#32' --limit 10
node tools/task-browser/metadata-cli.mjs clear '#32' --order
node tools/task-browser/metadata-cli.mjs add-related '#32' agent-framework/task-browser-prompt-copy-v2
node tools/task-browser/metadata-cli.mjs add-blocker '#32' '#12'
node tools/task-browser/metadata-cli.mjs set-parent '#32' agent-framework/task-browser-prompt-copy-v2
```

The CLI accepts display IDs and canonical task keys for task references. Relationship fields are stored as canonical task keys so browser relationship links remain reliable. Parent/child commands maintain reciprocal `parent`/`children` metadata from either side, and `related` commands maintain symmetric links. `blockedBy` is for existing task blockers only; generic blockers should be explained in `HANDOFF.md`, `CONTEXT.md`, or run logs while metadata uses `status: blocked`. The inverse `blocks` relationship is derived from other tasks' `blockedBy` metadata instead of stored separately.

Supported CLI metadata fields are `status`, `priority`, `type`, `order`, `parent`, `tags`, `blockedBy`, `children`, and `related`. Identity fields such as `displayId`, `project`, `slug`, and `path` are preserved. Write commands accept optional provenance flags `--actor`, `--role`, `--session-tool`, `--session-id`, and `--note`; agents should pass real role/session details when useful and available rather than inventing them.

## Metadata Hygiene Guidance

Use task-browser metadata only when the workspace has adopted task-browser, such as when `.tools-config/task-browser/tasks.json` exists or the Operator/current task says the board is used. Do not require this metadata in workspaces that are not using task-browser, and do not commit `.tools-config/task-browser/tasks.json` unless sharing local board state is intentional.

Scenario rules:

- task creation: initialize metadata for the discovered task, usually `planned` unless work starts immediately;
- pickup: set `status: active` for the current target;
- review: set `status: review` for Oracle/Operator review, `active` after a bounce, and `done` only after task files record closure;
- pause/block: use `paused` for deferral and `blocked` for a real blocker; use `blockedBy` only when another existing task is the blocker;
- relationships: use `parent`, `children`, and `related` for task splits and peer follow-ups; document execution-relevant relationships in task markdown too;
- closure: metadata may aid discovery, but task markdown and run logs remain the closure record.

## Guidance And Future Work

Deferred features and optimizations are tracked in `agent-framework/task-browser-deferred-features-and-optimizations`, including same-column DnD reordering, richer prompt-copy modes, richer relationship editing, performance improvements, and experimental shared/team metadata.

Local ignored `.tools-config/task-browser/tasks.json` is the default. Shared/team metadata should be treated as deliberate opt-in future design, not default behavior.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default: `8788`. |
| `WORKSPACE_ROOT` | Workspace to scan. Default: nearest parent containing `AGENTS.md`, otherwise current directory. |
| `TASK_BROWSER_METADATA` | Metadata JSON path. Default: `$WORKSPACE_ROOT/.tools-config/task-browser/tasks.json`. |
| `TASK_BROWSER_HISTORY` | Metadata history JSONL path. Default: next to metadata as `$WORKSPACE_ROOT/.tools-config/task-browser/task-history.jsonl`. |

## Migration

For existing-workspace upgrades from older metadata paths, use `MIGRATIONS.md` as the source of truth. Explicit `TASK_BROWSER_METADATA` and `TASK_BROWSER_HISTORY` override paths remain supported.

## Safety And Privacy

The tool is local-only and reads task markdown from the configured workspace. It writes only the task-browser metadata JSON file and metadata history JSONL file. Task names, paths, tags, relationships, timing, provenance, and handoff text can reveal private work details; do not commit `.tools-config/task-browser/tasks.json` or `.tools-config/task-browser/task-history.jsonl` unless that workspace state is intended to be shared.
