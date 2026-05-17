# Task Browser

A local browser for framework tracked tasks across workspace projects.

Use it to scan `projects/*/work/*/TASK.md`, initialize task-browser-owned metadata, and browse tasks by status, priority, type, tags, and resume files.

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
- horizontal board scrolling instead of stacked columns on narrow screens;
- multi-select status filters with `done` hidden by default;
- auto-refresh every 10 seconds by default, plus manual Refresh;
- narrow v1 search by display ID, project/slug/key, title, and tags;
- project and priority filters;
- closed-by-default task detail drawer with resume file paths, current handoff summary, purpose, success/acceptance text, and a full newest-first run timeline;
- a copyable generic task-pickup prompt with subtle hover/focus preview for starting the selected task in a new agent session.

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
      "tags": ["task-browser"]
    }
  }
}
```

Task Browser metadata owns UI/workflow fields: `displayId`, `status`, `priority`, `type`, `blockedBy`, `parent`, `children`, `related`, and `tags`.

Framework task files remain the source of truth for purpose, scope, acceptance criteria, narrative handoff/current state, stable context, and run evidence.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port. Default: `8788`. |
| `WORKSPACE_ROOT` | Workspace to scan. Default: nearest parent containing `AGENTS.md`, otherwise current directory. |
| `TASK_BROWSER_METADATA` | Metadata JSON path. Default: `$WORKSPACE_ROOT/.task-browser/tasks.json`. |

## Safety And Privacy

The tool is local-only and reads task markdown from the configured workspace. It writes only the task-browser metadata JSON file. Task names, paths, tags, and handoff text can reveal private work details; do not commit `.task-browser/tasks.json` unless that workspace state is intended to be shared.

## First-Slice Limits

- Metadata editing is done by editing `.task-browser/tasks.json` directly, then refreshing the browser or waiting for the next 10-second auto-refresh.
- Relationship fields are not yet rendered as clickable links.
- Status inference is intentionally minimal: new tasks default to `planned` unless edited.
- Micro tasks, daemon scheduling, review execution state, and SQLite storage are out of scope.
