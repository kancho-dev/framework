# Migration Notes

Use this file when updating an already framework-managed workspace across framework versions that changed operating guidance, templates, or optional tools.

These notes are version-specific checks, not a permanent setup checklist. Apply only the sections that fall between the workspace's installed `framework/CURRENT_VERSION` and the new `framework/VERSION`.

For the update procedure, use `framework/SKILLS/update-framework/SKILL.md`.

## v0.11.0 — Framework Cockpit And Daily-brief Safety

This release adds the optional Framework Cockpit tool (`agent-tool-orchestrator` `1.0.0`), promotes Task Browser to `1.2.0`, promotes Session Browser to `1.2.0`, and strengthens daily-brief overwrite safety guidance.

### Required checks

1. Merge the updated daily-brief guidance into workspace instructions where relevant: check whether `memory/daily-brief-YYYY-MM-DD.md` exists before writing, never overwrite an existing daily brief, and append or targeted-edit only.
2. If the workspace uses Task Browser or Session Browser, verify the standalone commands still work after updating. Both tools now support route-base-aware mounted mode for Framework Cockpit while preserving standalone mode.
3. If the workspace uses optional tool documentation or local command notes, mention that Framework Cockpit is available under `framework/tools/tool-orchestrator/`.

### Not required

- No workspace migration is required to use the core framework workflow.
- No Framework Cockpit setup is required in workspaces that do not want the optional shell.
- No `.task-browser/` metadata conversion is required.
- Existing standalone Task Browser and Session Browser usage remains valid.

## v0.10.0 — Task-browser Action History

This release promotes the task-browser tool package to `1.1.0` and adds local append-only action history for durable task-browser metadata changes.

### Required checks

1. If the workspace uses task-browser, keep `.task-browser/` private unless sharing local board state and provenance history is intentional. The new history file defaults to `.task-browser/task-history.jsonl` next to `.task-browser/tasks.json`.
2. Treat task markdown and run logs as authoritative. Action history explains task-browser metadata changes; it is not authentication, compliance audit, or a replacement for handoff/run-log records.
3. When agents update metadata through `framework/tools/task-browser/metadata-cli.mjs`, they may pass real provenance with `--role`, `--session-tool`, and `--session-id` when useful and available. Do not invent session IDs or role details.
4. Older installed framework copies do not write action history. History starts after the workspace updates to this version and uses the updated task-browser CLI/server.

### Not required

- No conversion is required for existing `.task-browser/tasks.json` files.
- No task-browser setup is required in workspaces that do not use it.
- Existing task directories and run logs remain valid.

## v0.9.1 — Task-browser Metadata CLI And Hygiene

This release promotes the task-browser tool package to `1.0.0` and adds a metadata CLI plus conditional metadata-hygiene guidance.

### Required checks

1. If the workspace uses task-browser, keep `.task-browser/tasks.json` aligned with tracked-task state. Use `framework/tools/task-browser/metadata-cli.mjs` for non-interactive updates.
2. Do not commit `.task-browser/tasks.json` unless sharing board metadata is an intentional workspace/team decision.
3. Treat task markdown as source of truth. Metadata should not be the only record of blockers, review results, or closure.
4. Store relationship metadata as canonical task keys. `blockedBy` should point only to existing task blockers; generic blockers belong in task markdown with metadata `status: blocked`.

### Not required

- No task-browser setup is required in workspaces that do not use it.
- No migration is required for existing standard task directories.

## v0.8.0 — Reduced Core And Reference Split

This release reduces the always-read core and moves detailed guidance out of `FRAMEWORK.md` into focused reference docs:

- `WORKSPACE.md` — workspace/project layout and state placement.
- `TASKS.md` — micro tasks, tracked task directories, task files, review loops, and task closure.
- `SKILLS.md` — skill discovery, precedence, index format, collisions, and optional resources.

Existing standard tracked-task workspaces remain compatible. Micro-task guidance is additive.

### Required checks

1. **Merge root `AGENTS.md` guidance.**
   - Remove `framework/ENGINEERING.md` from the unconditional main-session read order.
   - Keep `framework/ENGINEERING.md` as required before code or documentation implementation changes.
   - Mention `framework/WORKSPACE.md`, `framework/TASKS.md`, and `framework/SKILLS.md` as conditional reference docs.
   - Add the skill-discovery trigger: check relevant skill indexes before improvising when the prompt names a skill-like workflow, asks to "check skills", or describes a repeatable framework procedure.

2. **Check local skills and skill indexes for stale framework assumptions.**
   - Workspace-custom index: `SKILLS/INDEX.md`.
   - Workspace-custom skills: `SKILLS/*/SKILL.md`.
   - Project-local skill indexes: `projects/[name]/SKILLS/INDEX.md`.
   - Project-local framework-native skills: `projects/[name]/SKILLS/*/SKILL.md`.
   - Tool-native project skills or commands when supported by the current agent/tool, such as project `.claude/skills/`.

   Look for old assumptions such as:
   - `ENGINEERING.md` as always-read for every session;
   - older local experiments with non-standard task directory shapes;
   - detailed task/workspace/skill rules living only in `FRAMEWORK.md`;
   - skill indexes acting as mini manuals rather than routing tables;
   - Oracle reviews being mixed into Builder implementation runs instead of recorded as separate Oracle task runs when meaningful.

3. **Keep the standard task-directory invariant.**
   - Existing tracked tasks with `TASK.md`, `HANDOFF.md`, `CONTEXT.md`, and `runs/` remain valid.
   - New task directories should use the same standard shape.
   - Tiny one-run work can stay micro with no task directory and a daily brief / active-state update only when meaningful.

### Recommended checks

- If local `SKILLS/INDEX.md` files have grown into manuals, simplify them toward routing tables over time. Do not overwrite local entries blindly.
- If native command prompts were copied instead of symlinked, refresh them only when the Operator wants the new prompt wording.
- If other agent entrypoint files mirror root guidance, such as `CLAUDE.md` or tool-specific rules files, decide deliberately whether to align them with the updated `AGENTS.md` guidance.
- Update `framework/CURRENT_VERSION` to the new `framework/VERSION` only after the applicable migration checks are complete.

### Not required

- No migration is needed for existing standard task directories.
- No optional tool setup is required. `tools/session-browser/`, native command adapters, and `memory-service/` remain optional.
- No local skill rewrite is needed unless the skill encodes stale read order, non-standard task structure, or moved documentation references.
