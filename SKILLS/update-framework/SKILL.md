---
name: update-framework
description: "Bring an already framework-managed workspace into alignment with newer framework changes using minimal safe updates."
---

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
- `framework/VERSION`
- `framework/CURRENT_VERSION` when present
- relevant templates under `framework/TEMPLATES/`
- the current workspace root contents
- the current framework files already present in the workspace

## Steps

1. Read `framework/INSTALLATION.md` to understand the current expected setup shape, including the phased adoption guidance for existing workspaces.
2. Read `framework/CURRENT_VERSION` if it exists, and read the newly pulled `framework/VERSION`.
3. If `CURRENT_VERSION` is missing, treat the workspace as having an unknown installed framework version, create it from `VERSION` after the update, and mention that version-specific diff review was not possible.
4. If both versions exist and differ, inspect the framework changes between the old installed version and the new `VERSION` before changing workspace files. Prefer git tag comparison when tags exist, for example `git -C framework diff vOLD..vNEW -- INSTALLATION.md FRAMEWORK.md ROLES/ SKILLS/ TEMPLATES/ README.md USAGE-PROMPTS.md`; otherwise compare the current files directly and note the limitation.
5. Inspect the workspace root for the existing framework-managed files and directories.
6. Compare the current workspace setup against the latest framework expectations.
7. Check the actual repository boundaries before editing config files so the update does not guess wrongly about which repo owns what.
8. Check whether the root `.gitignore` still matches the current framework repository model and ignore guidance.
9. Recheck that workspace-owned `projects/[name]/library/` and `projects/[name]/work/` are not being ignored under the default model.
10. Add newly required files or directories when they are missing and templates clearly apply.
11. Update or merge existing workspace files only when needed to support new framework behavior or guidance.
12. Do not overwrite local workspace-specific instructions blindly.
13. If a merge is non-obvious, ask the user before changing the file.
14. Leave adapter-specific files such as `CLAUDE.md` intact unless the user explicitly wants them updated.
15. If the workspace uses other root agent/editor entrypoint files, decide deliberately whether they should mirror the same workspace guidance.
16. After the workspace has been updated, set `framework/CURRENT_VERSION` to match `framework/VERSION`.
17. Summarize the old version, new version, what changed, what was added, updated, left unchanged, or escalated.

## Outputs

- a workspace brought closer to the current framework expectations
- `framework/CURRENT_VERSION` updated to the installed framework version after successful sync
- only the necessary config/setup changes applied
- repo-boundary and root `.gitignore` expectations rechecked rather than assumed
- workspace-owned `library/` and `work` preserved under the default repo model while nested `project/` repositories remain ignored as expected
- a clear summary of required follow-up when user input was needed

## Stop Conditions

- the workspace no longer misses any newly required framework setup that clearly applies
- `framework/CURRENT_VERSION` matches `framework/VERSION` after successful sync
- any ambiguous merge or local-policy conflict has been escalated to the user

## Pitfalls / Anti-Patterns

- treating update as a fresh install and recreating files unnecessarily
- assuming repo ownership from the folder layout without checking the real nested repositories
- accidentally gitignoring workspace-owned `library/` or `work` paths while updating `.gitignore`
- overwriting customized `AGENTS.md`, `.gitignore`, `README.md`, or other workspace files blindly
- applying template changes that are not actually needed for the current framework update
- updating `CURRENT_VERSION` before checking whether the old/new framework versions require workspace changes
- changing adapter-specific files by default

## Related Files / Tools

- `framework/INSTALLATION.md`
- `framework/README.md`
- `framework/TEMPLATES/WORKSPACE/`
- `framework/TEMPLATES/TASKS/`
