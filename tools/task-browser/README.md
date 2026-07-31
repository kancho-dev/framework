# Task Browser

A local browser for framework tracked tasks across workspace projects.

Use it to scan `projects/*/work/*/TASK.md`, initialize task-browser-owned metadata, and browse tasks by status, priority, type, tags, relationships, and task-local files.

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
- compact canonical slugs on task cards;
- task detail drawer with Purpose, Next steps, clickable Run timeline, Files, Success/Acceptance, and Metadata history; Next steps are read from `HANDOFF.md` `## Next Action` with `## Next Steps` fallback;
- on-demand, safely rendered Markdown readers for root task files and individual run logs; non-Markdown root artifacts remain discoverable but are never fetched for preview;
- run cards prefer the run file's first `#` heading, then a readable title derived from timestamped filenames, then the raw filename;
- editable status, priority, type, next actor, tags, and optional positive-integer order metadata;
- an icon-only person/robot badge beside each task display ID when Operator/Agent action is next;
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
      "nextActor": "agent",
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

Task Browser metadata owns UI/workflow fields: `displayId`, `status`, `priority`, `type`, nullable `nextActor`, `blockedBy`, `parent`, `children`, `related`, `tags`, and optional positive-integer `order`.

`nextActor` is `operator`, `agent`, or `null` and answers who must take the next meaningful action for the task to advance. It is not task status, ownership, an assignee, or the narrative next action. The board renders set values as accessible icon-only person/robot badges beside the display ID; unset tasks have no badge. Framework `TASKS.md` is the authoritative source for scenario-based update rules.

`GET /api/summary` exposes `nextActors.counts.operator`, `nextActors.counts.agent`, and up to three compact `nextActors.operatorTasks` for the selected workspace. Only `planned`, `active`, `blocked`, and `review` tasks with accepted actor values are included; `paused`, `done`, unset, and unknown values are excluded defensively. Operator tasks are ordered by actionable status (`blocked`, `review`, `active`, `planned`), priority, explicit order, discovery order, title, and key. Cockpit consumes this contract without reproducing task-domain rules.

Framework task files remain the source of truth for purpose, scope, acceptance criteria, narrative handoff/current state, stable context, and run evidence.

## Metadata History

Task Browser writes an append-only local JSONL history for durable task-browser metadata changes by default:

```text
.tools-config/task-browser/task-history.jsonl
```

Each event records the task key/display ID, timestamp, source, best-effort provenance, and before/after values for changed durable metadata fields: `status`, `priority`, `type`, `nextActor`, `tags`, `order`, `parent`, `children`, `blockedBy`, and `related`. Identity/discovery refresh fields such as `displayId`, `project`, `slug`, `path`, and `missing` are not logged as action history.

Browser edits and drag/drop writes default to `actor: "operator"`, `source: "browser"`, and null role/session fields. CLI writes default to `actor: "agent"`, `source: "metadata-cli"`, and null role/session fields unless explicitly provided. This is provenance for local handoff, not authentication or a compliance-grade audit trail.

No-op writes where normalized before/after metadata values are identical do not append events. Safe deletion/retention is simple: stop the server/CLI if active, then delete or archive `.tools-config/task-browser/task-history.jsonl`; current board state remains in `.tools-config/task-browser/tasks.json`.

## Editing And Drag/Drop

The detail drawer can edit common metadata fields directly:

- status, priority, type, and nullable next actor through compact pill selects;
- board filter selects through shared capped-height listbox styling;
- tags through add/remove controls with shared capped-height autocomplete suggestions from existing task tags;
- optional order through a small numeric input.

Metadata edits call the local `PATCH /api/task-metadata` endpoint and write only task-browser metadata. They do not silently edit `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, or run logs.

## Steering Notes

The detail drawer also exposes the selected discovered task's optional `NOTES.md` as **Steering Notes**: one transient instruction for the next Task Run. Explicit Save and Clear actions use a constrained `PUT /api/steering-notes` endpoint; Clear deletes the file. A card indicator appears only while non-whitespace guidance is pending. Dirty drafts survive board refresh, and revision conflicts prevent a stale editor from overwriting a note changed or consumed elsewhere.

Steering Notes are not live messaging: an Agent checks once at task-run start, immediately deletes `NOTES.md` after capturing a non-empty payload, and does not poll. Saving does not change status or `nextActor`. Note content is never copied into task-browser metadata or history. See framework `TASKS.md` for authorship, one-shot consumption, conflict-authority, and run-log rules. Workspace `OPERATOR-NOTES.md` is a separate durable Operator-maintained list.

Dragging a card to another status column changes only that task's task-browser metadata `status`; it never infers or rewrites `nextActor`. The target column is highlighted while dragging. Same-column drag reordering is deferred; a future implementation should show a clear between-card insertion target and update only the minimal `order` values needed.

## Relationships

When metadata includes `blockedBy`, `parent`, `children`, or `related`, the detail header shows compact relationship pills grouped by relation type. Known tasks are shown by display ID (for example `#32`) and open that task in the detail drawer. The drawer also derives a read-only `blocks` view from other tasks that list the current task in `blockedBy`.

Relationship edits use existing task references with shared capped-height autocomplete and store canonical task keys. `parent` and `children` are reciprocal: setting a parent adds the child to the parent, adding/removing children updates each child's parent, moving a child removes it from the old parent, and cycles/self-parenting are rejected. `related` is symmetric, so adding or removing a related task updates both tasks. `blockedBy` remains the stored directional source of truth; use the derived `blocks` view to see tasks this task is blocking.

## Metadata CLI

Commands, task references, supported fields, and provenance flags live in `METADATA-CLI.md` in this directory.

## Metadata Hygiene Guidance

Use task-browser metadata only when the workspace has adopted task-browser, such as when `.tools-config/task-browser/tasks.json` exists or the Operator/current task says the board is used. Do not require this metadata in workspaces that are not using task-browser, and do not commit `.tools-config/task-browser/tasks.json` unless sharing local board state is intentional.

Framework `TASKS.md` owns lifecycle status semantics and the `nextActor` matrix. Follow it for creation, pickup, review, bounce, blocker, pause, and closure decisions. Before ending meaningful task work, keep `nextActor` aligned with `HANDOFF.md`'s narrative next action and clear it when no Operator/Agent step is currently actionable.

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

For existing-workspace upgrades from older metadata paths, see the metadata-path move in `migrations/v0.14.0.md`, indexed from `MIGRATIONS.md`. Explicit `TASK_BROWSER_METADATA` and `TASK_BROWSER_HISTORY` override paths remain supported.

## Safety And Privacy

The tool is local-only and reads task markdown from the configured workspace. Task-file inventory is limited to immediate regular files in the selected task root; run logs are listed separately. Preview endpoints accept only basename-only `.md` paths, reject symlinks and traversal, enforce a 1 MB limit, and load bodies only on demand. Files are opened without following a final symlink and verified/read through that same handle to avoid validation/read races. Markdown is escaped before the small supported formatting subset is rendered, and only `http`/`https` links become anchors. It writes task-browser metadata/history and, only through the Steering Notes endpoint, safely replaces or deletes `NOTES.md` inside a currently discovered canonical task directory. Task keys, payload type and size, canonical confinement, and stale revisions are validated server-side; the payload is not logged or copied to metadata/history. Task names, note contents, paths, tags, relationships, timing, provenance, and handoff text can reveal private work details. Protect task files, and do not commit `.tools-config/task-browser/tasks.json` or `.tools-config/task-browser/task-history.jsonl` unless that workspace state is intended to be shared.
