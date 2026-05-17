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
- task detail drawer with Purpose, Next steps, Run timeline, Current state, Success/Acceptance, Resume files, and Context; Next steps are read from `HANDOFF.md` `## Next Action` with `## Next Steps` fallback;
- editable status, priority, type, tags, and optional order metadata;
- relationship metadata (`blockedBy`, `parent`, `children`, `related`) when present, with links to known tasks;
- cross-column drag/drop to change task status;
- a copyable generic task-pickup prompt with subtle hover/focus preview.

## Sorting

Task Browser sorts cards deterministically in the frontend.

For non-`done` columns:

1. optional numeric `order` metadata, ascending;
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

Task Browser stores workflow metadata in a workspace-level JSON file by default:

```text
.task-browser/tasks.json
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

Task Browser metadata owns UI/workflow fields: `displayId`, `status`, `priority`, `type`, `blockedBy`, `parent`, `children`, `related`, `tags`, and optional `order`.

Framework task files remain the source of truth for purpose, scope, acceptance criteria, narrative handoff/current state, stable context, and run evidence.

## Editing And Drag/Drop

The detail drawer can edit common metadata fields directly:

- status, priority, and type through compact pill selects;
- tags through add/remove controls;
- optional order through a small numeric input.

Edits call the local `PATCH /api/task-metadata` endpoint and write only task-browser metadata. They do not silently edit `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, or run logs.

Dragging a card to another status column changes only that task's task-browser metadata `status`. The target column is highlighted while dragging. Same-column drag reordering is deferred; a future implementation should show a clear between-card insertion target and update only the minimal `order` values needed.

## Relationships

When metadata includes `blockedBy`, `parent`, `children`, or `related`, the detail header shows compact relationship pills grouped by relation type. Known tasks are shown by display ID (for example `#32`) and open that task in the detail drawer. Relationship editing is deferred.

## Guidance And Future Work

Detailed rules for when agents should update task-browser metadata are tracked in child task `agent-framework/task-browser-metadata-guidance-rules`.

Deferred features and optimizations are tracked in `agent-framework/task-browser-deferred-features-and-optimizations`, including same-column DnD reordering, richer prompt-copy modes, richer relationship editing, performance improvements, and experimental shared/team metadata.

Local ignored `.task-browser/tasks.json` remains the default. Shared/team metadata should be treated as deliberate opt-in future design, not default behavior.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default: `8788`. |
| `WORKSPACE_ROOT` | Workspace to scan. Default: nearest parent containing `AGENTS.md`, otherwise current directory. |
| `TASK_BROWSER_METADATA` | Metadata JSON path. Default: `$WORKSPACE_ROOT/.task-browser/tasks.json`. |

## Safety And Privacy

The tool is local-only and reads task markdown from the configured workspace. It writes only the task-browser metadata JSON file. Task names, paths, tags, relationships, and handoff text can reveal private work details; do not commit `.task-browser/tasks.json` unless that workspace state is intended to be shared.
