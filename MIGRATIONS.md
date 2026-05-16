# Migration Notes

Use this file when updating an already framework-managed workspace across framework versions that changed operating guidance, templates, or optional tools.

These notes are version-specific checks, not a permanent setup checklist. Apply only the sections that fall between the workspace's installed `framework/CURRENT_VERSION` and the new `framework/VERSION`.

For the update procedure, use `framework/SKILLS/update-framework/SKILL.md`.

## v0.8.0 — Reduced Core And Reference Split

This release reduces the always-read core and moves detailed guidance out of `FRAMEWORK.md` into focused reference docs:

- `WORKSPACE.md` — workspace/project layout and state placement.
- `TASKS.md` — micro tasks, tracked task directories, task files, review loops, and task closure.
- `SKILLS.md` — skill discovery, precedence, index format, collisions, and optional resources.

Existing full-task workspaces remain compatible. Minimal and micro task guidance is additive.

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
