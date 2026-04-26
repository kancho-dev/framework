# Workspace Agent Instructions

Operate from the workspace root.

## Required Read Order

At the start of a main session, read:
1. `framework/FRAMEWORK.md`
2. `framework/SECURITY.md`
3. `framework/ENGINEERING.md`
4. `framework/ROLES/OVERSEER.md`
5. `ACTIVE-CONTEXT.md`
6. today's `memory/daily-brief-YYYY-MM-DD.md` if it exists; otherwise read the latest daily brief file present under `memory/` if any exist
   - If today's brief does not exist and you later create it, carry forward only important unfinished items from the latest previous brief into a short top section before adding normal entries.

Load skills only when they are relevant to the current run. Framework skills live under `framework/SKILLS/`; when framework skill choice is unclear, read `framework/SKILLS/INDEX.md` first, then read only the selected `framework/SKILLS/[skill-name]/SKILL.md` files.

Workspace-custom skills may live under root `SKILLS/`; when local skill choice is unclear or the user mentions a workspace-specific workflow, read `SKILLS/INDEX.md` if it exists, then read only the selected `SKILLS/[skill-name]/SKILL.md` files. Avoid creating workspace skills with the same name as framework skills; if a collision exists, ask whether to rename the local skill or treat it as an explicit override. Do not read every skill by default.

When working inside a task directory, then read the task files in the order defined by `framework/FRAMEWORK.md`.

## Workspace Rules

1. Keep active workspace state in `ACTIVE-CONTEXT.md`.
2. Record durable fixes in `FIXES.md`.
3. Use `OPERATOR-NOTES.md` for Operator-maintained todos and ideas.
4. Keep durable project knowledge under `projects/[name]/library/`.
5. Keep task execution state under `projects/[name]/work/[task-slug]/`.
6. Treat `framework/` as the source of operating guidance for this workspace.
7. Treat `framework/` as read-only. Never edit files under `framework/` directly.
8. For daily briefs and task run logs, use the real current system date/time from the live environment, not chat/session metadata. If needed, query it explicitly with `date '+%F %R %Z'`. Never use invented placeholder times such as `00:00`.
9. When creating today's daily brief from a previous brief, add a short `Carry-forward from previous brief` section containing only important unfinished items that still appear actionable.

## Workspace-Specific Instructions

- [describe the main active project or workspace focus]
- [describe any local conventions or constraints]
