# Installation

Use this guide when setting up the framework in the current workspace.

The goal is a clean, usable workspace setup, not a heavy installer.

This is the main starting point for first-time adoption.
`memory-service/`, `tools/`, and native command templates are optional and are not required for the basic framework workflow.

## Supported Situations

### Fresh workspace

Use this path when the current directory is a new or mostly empty workspace.

### Existing workspace

Use this path when the current directory already contains projects and/or agent-facing files such as `AGENTS.md` or `CLAUDE.md`.

Do not treat this as a separate complex mode system.
Just adapt the same setup flow carefully.
Incremental adoption is normal: a real workspace may move into the framework in phases rather than all at once.

## Core Rules

1. Operate from the workspace root.
2. Do not overwrite existing user files blindly.
3. Create missing framework files from templates when the templates fit.
4. If a file already exists and the correct merge is not obvious, ask the user.
5. Prefer minimal setup that leaves the workspace usable immediately.
6. Keep framework-specific guidance in framework files; keep workspace-specific guidance in workspace files.

## Install Flow

1. Confirm the current directory is the intended workspace root.
2. Ensure the framework repository is present under `framework/`.
3. Decide whether the workspace is closer to a fresh setup or an existing-workspace adoption.
4. Inspect whether the workspace already has:
   - `.gitignore`
   - `README.md`
   - `AGENTS.md`
   - `CLAUDE.md`
   - `ACTIVE-CONTEXT.md`
   - `OPERATOR-NOTES.md`
   - `FIXES.md`
   - `memory/`
   - `projects/`
   - optional workspace-custom `SKILLS/`
5. Create missing directories and files from templates when appropriate.
6. Ensure the root `.gitignore` matches the intended repository model.
7. If `AGENTS.md` is missing, create it from the workspace template.
8. If `AGENTS.md` already exists, merge the framework-required guidance into it rather than replacing it.
9. If `CLAUDE.md` exists, do not overwrite it. If relevant, suggest mirroring the same workspace guidance there.
10. After successful install/adoption, create or update gitignored `framework/CURRENT_VERSION` from `framework/VERSION` so the workspace records the framework version it has installed.
11. Leave the workspace in a state where an agent can begin operating with the framework immediately.

## Recommended Incremental Adoption Sequence

For an already-active workspace, prefer this order:

1. confirm the workspace root and clone the framework into `framework/`
2. inspect the current root files and repo boundaries before creating or merging anything
3. fix the root `.gitignore` early so nested repositories do not become a recurring footgun
4. create or merge the minimum workspace-level files needed for agent operation (`AGENTS.md`, `ACTIVE-CONTEXT.md`, `FIXES.md`, optional `OPERATOR-NOTES.md`)
5. create `projects/` entries gradually rather than forcing every existing project into the full layout immediately
6. migrate each project into `project/`, `library/`, and `work/` when that project actually needs framework-managed coordination
7. after successful install/adoption, create or update `framework/CURRENT_VERSION` from `framework/VERSION`
8. leave the workspace usable after each step rather than waiting for one big migration to finish

This framework supports phased adoption. A workspace does not need to become perfectly reorganized in one session before the framework is useful.

## Repository Model And Boundary Check

Current default repository model:
- the workspace root is its own git repository for workspace files plus project coordination files
- `framework/` remains its own git repository
- `projects/[name]/library/` and `projects/[name]/work/` belong to the workspace root repo by default
- `projects/[name]/project/` is the code location and is expected to be its own git repository in the default setup

Why keep this as the default:
- it removes separate coordination-repo decisions from the baseline setup
- it keeps most coordination work in one place, which fits typical framework usage better
- it preserves a clean boundary for project code without forcing extra git structure for project notes and tasks

Separate per-project coordination repos remain possible as an advanced optional pattern, but they are not the default.

Before finishing install/adoption, explicitly check:
- which repository owns the workspace-root files
- that `framework/` is treated as a nested repository rather than absorbed into the root repo
- whether any `projects/[name]/project/` directories are their own repositories
- whether the current workspace is in a mixed migration state and therefore needs ignore rules that protect nested `project/` repos without hiding workspace-owned `library/` and `work/`

Do not infer repo ownership only from folder names. Check the actual repository boundaries and then align the root `.gitignore` to match them.

## Files To Create When Missing

Use templates under `framework/TEMPLATES/`.

### Workspace-level files

- `.gitignore` → `framework/TEMPLATES/WORKSPACE/.gitignore`
- `README.md` → `framework/TEMPLATES/WORKSPACE/README.md`
- `AGENTS.md` → `framework/TEMPLATES/WORKSPACE/AGENTS.md`
- `ACTIVE-CONTEXT.md` → `framework/TEMPLATES/WORKSPACE/ACTIVE-CONTEXT.md`
- `OPERATOR-NOTES.md` → `framework/TEMPLATES/WORKSPACE/OPERATOR-NOTES.md`
- `FIXES.md` → `framework/TEMPLATES/WORKSPACE/FIXES.md`
- optional workspace skill index: `SKILLS/INDEX.md` → `framework/TEMPLATES/WORKSPACE/SKILLS/INDEX.md`
- optional project skill index: `projects/[name]/SKILLS/INDEX.md` → `framework/TEMPLATES/PROJECT/SKILLS/INDEX.md`

### Task files

- `TASK.md` → `framework/TEMPLATES/TASKS/TASK.md`
- `HANDOFF.md` → `framework/TEMPLATES/TASKS/HANDOFF.md`
- `CONTEXT.md` → `framework/TEMPLATES/TASKS/CONTEXT.md`
- run log entry → `framework/TEMPLATES/TASKS/RUN-LOG.md`

## Optional Native Commands

The framework includes optional Markdown command templates under:

```text
framework/prompts/
```

These templates expose slash commands such as `/next-best-actions`, `/update-framework`, and `/workspace-maintenance` in Pi when symlinked or copied into workspace `.pi/prompts/`, and in OpenCode when symlinked or copied into workspace `.opencode/commands/`.

Recommended Linux/macOS setup is symlinking tool-local command files to `framework/prompts/*.md`, so prompt changes arrive with normal framework updates. Copying the files is the simpler fallback, especially on Windows or filesystems where symlinks are inconvenient. In either case, inspect existing command files first and ask before replacing same-name local prompts/commands.

Detailed Pi and OpenCode setup options are documented in `framework/COMMANDS.md`. Do not mutate OpenCode `opencode.json` automatically during basic framework installation unless the Operator explicitly asks for it and the target config is clear.

Native commands are convenience adapters only. The framework remains usable through normal prompts.

## Optional Session Browser Tool

The framework includes an optional local session browser under:

```text
framework/tools/session-browser/
```

It is a read-only web tool for browsing Pi JSONL sessions and OpenCode SQLite sessions for the current workspace.

Quick start after the framework is present in a workspace:

```bash
cd framework/tools/session-browser
npm start
```

Then open:

```text
http://localhost:8787
```

Requirements:

- Node.js.
- Optional for OpenCode support: `sqlite3` CLI on `PATH`.

Useful configuration:

- `WORKSPACE_ROOT` — workspace whose sessions should be shown.
- `PORT` — local HTTP port, default `8787`.
- `SESSION_SOURCES` — `pi`, `opencode`, or `pi,opencode`.
- `PI_SESSION_ROOT` / `SESSION_ROOT` — Pi JSONL session root.
- `OPENCODE_DB` / `OPENCODE_DATA_DIR` — OpenCode SQLite database/data location.

Safety:

- the tool is local-only and read-only by default;
- do not commit private transcripts, cwd paths, tool outputs, copied databases, exports, logs, env files, or dependency/cache folders;
- for full setup/use details, read `framework/tools/session-browser/README.md`.

## Existing File Guidance

### `.gitignore`

- if missing, create from the template
- if present, merge the framework-related ignore rules into it rather than replacing unrelated local rules
- by default, ignore the nested `framework/` repository, nested `projects/[name]/project/` repositories, `OPERATOR-NOTES.md`, and tool-local adapter/cache directories such as `.pi/` and `.opencode/`
- do not ignore `projects/[name]/library/` or `projects/[name]/work/` in the default model; those belong to the workspace root repo
- check this early in an existing-workspace adoption; it is one of the easiest places to make the workspace awkward by accident
- if the workspace is in a mixed migration state, make sure the ignore rules still match the real nested-repo boundaries instead of assuming every project is already organized identically

Example root `.gitignore`:

```gitignore
# Nested framework repository
framework/.git/
framework/

# Nested project code repositories in the default setup
projects/*/project/.git/
projects/*/project/

# Keep the coordination tree visible to the workspace repo
!projects/
!projects/*/

# Operator-maintained notes
OPERATOR-NOTES.md

# Tool-local workspace adapters and caches
.pi/
.opencode/
```

### `README.md`

- if missing, create from the template
- if present, keep it unless the user wants it aligned with the framework template

### `AGENTS.md`

- if missing, create from the template
- if present, merge the framework-specific read order and workspace rules into the existing file
- do not remove workspace-specific instructions already present
- if the workspace also uses other root agent/editor entrypoint files such as `CLAUDE.md` or tool-specific rule files, decide deliberately whether they should mirror the same workspace guidance

### `CLAUDE.md`

- not required by the framework
- do not create it by default
- if present, leave it intact and optionally mirror relevant workspace guidance there

### `ACTIVE-CONTEXT.md`, `OPERATOR-NOTES.md`, `FIXES.md`

- if missing, create from templates
- if present, preserve existing content unless the user asks for restructuring
- `OPERATOR-NOTES.md` is gitignored by default in the recommended root `.gitignore`

### Local skills and tool-native capabilities

- not required for basic framework use
- project-local capabilities may already exist in a project repo, for example tool-native skills/commands such as `.claude/skills/`, or documented project workflows; preserve them and reference them from project instructions when useful
- if one project needs portable framework-native skills, add them under `projects/[name]/SKILLS/[skill-name]/SKILL.md` with `projects/[name]/SKILLS/INDEX.md`
- if the workspace has cross-project local workflows, create `SKILLS/INDEX.md` from the workspace template and add skills under `SKILLS/[skill-name]/SKILL.md`
- keep local framework-native skills out of `framework/SKILLS/`; use `framework/SKILLS/create-workspace-skill/SKILL.md` as the baseline pattern when creating them
- local-capability precedence is project-local → workspace → framework; avoid same-name local skills unless the Operator explicitly wants an override
- preserve existing local skill files if present and merge index guidance rather than replacing it

## When To Ask The User

Ask when:
- the workspace root is unclear
- an existing `AGENTS.md` or `README.md` should be merged but the right result is ambiguous
- the user may want framework guidance mirrored into `CLAUDE.md`
- a local convention conflicts with the framework defaults

## Public-Repo Hygiene Reminder

If you are updating these docs from an internal or client-specific workspace, do not copy:
- private task history
- internal coordination notes
- secrets or credentials
- user-specific local paths unless they are clearly generic placeholders
- examples that expose non-public project names or repository details

Keep this repository limited to reusable framework guidance that is safe to share with others.

## Done Criteria

A framework install/adoption is good enough when:
- `framework/` is present in the workspace
- `framework/CURRENT_VERSION` exists and matches `framework/VERSION` after install/adoption
- the key workspace files exist or a deliberate keep/merge decision was made
- the workspace agent instructions point agents to `framework/`
- the root `.gitignore` matches the actual nested-repository boundaries
- workspace-owned `library/` and `work` areas are not accidentally ignored in the default model
- the workspace can support a normal Overseer session without extra hidden setup
- an existing/non-empty workspace has a workable next step for phased migration instead of needing a full one-shot reorganization
