# Skill: Update Framework

## Purpose

Bring an already framework-managed workspace into alignment with newer framework changes using minimal safe updates.

## When To Use

- when the framework repository in a workspace has been updated after time has passed
- when new framework features introduce additional setup or configuration steps
- when the workspace should be checked for drift against the current framework expectations

## Recommended Roles

- Overseer
- Historian

## Required Inputs

- `framework/INSTALLATION.md`
- `framework/README.md`
- relevant templates under `framework/TEMPLATES/`
- the current workspace root contents
- the current framework files already present in the workspace

## Steps

1. Read `framework/INSTALLATION.md` to understand the current expected setup shape.
2. Inspect the workspace root for the existing framework-managed files and directories.
3. Compare the current workspace setup against the latest framework expectations.
4. Add newly required files or directories when they are missing and templates clearly apply.
5. Check whether the root `.gitignore` still matches the current framework repository model and ignore guidance.
6. Update or merge existing workspace files only when needed to support new framework behavior or guidance.
7. Do not overwrite local workspace-specific instructions blindly.
8. If a merge is non-obvious, ask the user before changing the file.
9. Leave adapter-specific files such as `CLAUDE.md` intact unless the user explicitly wants them updated.
10. Summarize what was added, updated, left unchanged, or escalated.

## Outputs

- a workspace brought closer to the current framework expectations
- only the necessary config/setup changes applied
- a clear summary of required follow-up when user input was needed

## Stop Conditions

- the workspace no longer misses any newly required framework setup that clearly applies
- any ambiguous merge or local-policy conflict has been escalated to the user

## Pitfalls / Anti-Patterns

- treating update as a fresh install and recreating files unnecessarily
- overwriting customized `AGENTS.md`, `.gitignore`, `README.md`, or other workspace files blindly
- applying template changes that are not actually needed for the current framework update
- changing adapter-specific files by default

## Related Files / Tools

- `framework/INSTALLATION.md`
- `framework/README.md`
- `framework/TEMPLATES/WORKSPACE/`
- `framework/TEMPLATES/TASKS/`
