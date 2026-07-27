# Workspace Reference

Use this reference when creating, adopting, or maintaining a framework-managed workspace.

## Workspace Files

### `ACTIVE-CONTEXT.md`

Hot memory for the whole workspace. Update it when priorities change, work starts or finishes, blockers appear, or the Operator changes direction.

### `OPERATOR-NOTES.md`

Optional Operator-maintained notes for human todos, ideas, questions, blockers, or reminders. Treat it as reference by default. Only append short Operator-action notes when workspace rules explicitly allow it.

### `memory/daily-brief-YYYY-MM-DD.md`

Shared daily log. Append a short factual entry after meaningful work. Use the real current system date/time from the live environment and write to today's dated file, not a previous day's file.

Daily brief structure is: optional `Carry-forward from previous brief` section first, then timed log entries ordered by their real log time. Add each new timed entry at the end of today's file; do not insert new timed entries above existing timed entries. Before creating or writing a daily-brief file, check whether that dated file already exists. Never use an overwrite/write-file operation on an existing daily brief; use append or targeted edit only, preserving all existing entries.

When creating today's brief from a previous brief, add a short `Carry-forward from previous brief` section with only important unfinished actionable items before the timed entries. When a carry-forward item in today's brief is clearly completed or no longer actionable, mark it checked (`[x]`) in today's brief; do this only when confirmed by task state, closure, or explicit Operator direction, and do not rewrite older daily briefs. Move durable multi-day state to `ACTIVE-CONTEXT.md`, task files, project `library/`, `OPERATOR-NOTES.md`, or `FIXES.md` instead of relying only on carry-forward.

### `FIXES.md`

Durable record for non-obvious bugs, failed approaches, and fixes. Check it before inventing a workaround for a known issue.

## Project Structure

Each project lives under `projects/[name]/`.

Recommended project shape:

```text
projects/[name]/
  README.md
  library/
    decisions.md
    plans.md
    notes.md
    research.md
    deliverables/
  work/
    task-slug/
  project/
```

### `projects/[name]/project/`

The actual software project. It is usually its own repository in the default setup.

### `projects/[name]/library/`

Durable project knowledge. Keep at least:

- `decisions.md` — decisions that still matter.
- `plans.md` — active or upcoming work planning.
- `notes.md` — factual project notes.
- `research.md` — references, comparisons, and findings.

Optional `deliverables/` can hold polished reusable outputs.

### `projects/[name]/work/`

Task execution state. Use one directory per trackable task when the work needs durable task state. See `framework/TASKS.md`.

## Repository Structure

Recommended default:

- workspace root is its own repository for workspace and project-coordination files;
- `framework/` stays as its own nested repository;
- `projects/[name]/project/` is the software project repository;
- `projects/[name]/library/` and `projects/[name]/work/` belong to the workspace root repo by default.

This keeps coordination lightweight while preserving a clean code boundary.

If a team wants isolated git history for non-code coordination files too, separate per-project coordination repos remain possible as an advanced optional pattern.

If using the default model, configure the workspace root repository to ignore nested repositories such as:

- `framework/`
- `projects/*/project/`

Also ignore local adapter/cache metadata such as `.pi/`, `.opencode/`, and `.tools-config/` unless that workspace state is intentionally shared.

Do not ignore `projects/[name]/library/` or `projects/[name]/work/` in the default model.

## What Goes Where

- current workspace priority → `ACTIVE-CONTEXT.md`
- Operator-facing todos and ideas → `OPERATOR-NOTES.md`
- daily progress summary → `memory/daily-brief-*.md`
- stable task facts → task `CONTEXT.md`
- current task state → task `HANDOFF.md`
- durable project knowledge → `projects/[name]/library/*.md`
- durable fixes and mistakes → `FIXES.md`
- exact historical recall → task, library, daily-brief, and Git history under the workspace
- private tools config/state → `.tools-config/`
- task-browser workflow metadata → `.tools-config/task-browser/tasks.json`
- task-browser metadata-change history → `.tools-config/task-browser/task-history.jsonl`
- session-browser bookmark/tag metadata → `.tools-config/session-browser/metadata.json`
- tool-orchestrator workspace config → `.tools-config/tool-orchestrator/workspaces.json`

## Tool Agnosticism

Do not assume a specific chat platform, transcript format, cron system, model vendor, or web UI. Treat those as adapters outside the framework core.
