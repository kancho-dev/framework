# Installation

Use this guide when setting up the framework in the current workspace.

The goal is a clean, usable workspace setup, not a heavy installer.

## Supported Situations

### Fresh workspace

Use this path when the current directory is a new or mostly empty workspace.

### Existing workspace

Use this path when the current directory already contains projects and/or agent-facing files such as `AGENTS.md` or `CLAUDE.md`.

Do not treat this as a separate complex mode system.
Just adapt the same setup flow carefully.

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
3. Inspect whether the workspace already has:
   - `.gitignore`
   - `README.md`
   - `AGENTS.md`
   - `CLAUDE.md`
   - `ACTIVE-CONTEXT.md`
   - `OPERATOR-NOTES.md`
   - `FIXES.md`
   - `memory/`
   - `projects/`
4. Create missing directories and files from templates when appropriate.
5. Ensure the root `.gitignore` matches the intended repository model.
6. If `AGENTS.md` is missing, create it from the workspace template.
7. If `AGENTS.md` already exists, merge the framework-required guidance into it rather than replacing it.
8. If `CLAUDE.md` exists, do not overwrite it. If relevant, suggest mirroring the same workspace guidance there.
9. Leave the workspace in a state where an agent can begin operating with the framework immediately.

## Files To Create When Missing

Use templates under `framework/TEMPLATES/`.

### Workspace-level files

- `.gitignore` → `framework/TEMPLATES/WORKSPACE/.gitignore`
- `README.md` → `framework/TEMPLATES/WORKSPACE/README.md`
- `AGENTS.md` → `framework/TEMPLATES/WORKSPACE/AGENTS.md`
- `ACTIVE-CONTEXT.md` → `framework/TEMPLATES/WORKSPACE/ACTIVE-CONTEXT.md`
- `OPERATOR-NOTES.md` → `framework/TEMPLATES/WORKSPACE/OPERATOR-NOTES.md`
- `FIXES.md` → `framework/TEMPLATES/WORKSPACE/FIXES.md`

### Task files

- `TASK.md` → `framework/TEMPLATES/TASKS/TASK.md`
- `HANDOFF.md` → `framework/TEMPLATES/TASKS/HANDOFF.md`
- `CONTEXT.md` → `framework/TEMPLATES/TASKS/CONTEXT.md`
- run log entry → `framework/TEMPLATES/TASKS/RUN-LOG.md`

## Existing File Guidance

### `.gitignore`

- if missing, create from the template
- if present, merge the framework-related ignore rules into it rather than replacing unrelated local rules
- by default, ignore nested project repositories, the nested `framework/` repository, and `OPERATOR-NOTES.md`

Example root `.gitignore`:

```gitignore
# Nested project repositories
projects/*/.git/
projects/*/

# Framework repository
framework/.git/
framework/

# Keep the projects directory itself
!projects/

# Operator-maintained notes
OPERATOR-NOTES.md
```

### `README.md`

- if missing, create from the template
- if present, keep it unless the user wants it aligned with the framework template

### `AGENTS.md`

- if missing, create from the template
- if present, merge the framework-specific read order and workspace rules into the existing file
- do not remove workspace-specific instructions already present

### `CLAUDE.md`

- not required by the framework
- do not create it by default
- if present, leave it intact and optionally mirror relevant workspace guidance there

### `ACTIVE-CONTEXT.md`, `OPERATOR-NOTES.md`, `FIXES.md`

- if missing, create from templates
- if present, preserve existing content unless the user asks for restructuring
- `OPERATOR-NOTES.md` is gitignored by default in the recommended root `.gitignore`

## When To Ask The User

Ask when:
- the workspace root is unclear
- an existing `AGENTS.md` or `README.md` should be merged but the right result is ambiguous
- the user may want framework guidance mirrored into `CLAUDE.md`
- a local convention conflicts with the framework defaults

## Done Criteria

A framework install/adoption is good enough when:
- `framework/` is present in the workspace
- the key workspace files exist or a deliberate keep/merge decision was made
- the workspace agent instructions point agents to `framework/`
- the workspace can support a normal Overseer session without extra hidden setup
