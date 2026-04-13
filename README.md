# Portable Agent Framework

Minimal, agent-agnostic framework for AI-assisted software development.

This repository is intended to be cloned into the root of each workspace as a dedicated framework directory.

## Intended Workspace Layout

Clone this framework into the workspace root, then keep the active workspace files next to it.

Recommended shape:

```text
workspace/
  .gitignore
  README.md
  AGENTS.md
  ACTIVE-CONTEXT.md
  FIXES.md
  memory/
    daily-brief-YYYY-MM-DD.md
  projects/
    my-project/
      README.md
      project/
      library/
        decisions.md
        plans.md
        notes.md
        research.md
      work/
        nx-013-build-pipeline/
          TASK.md
          HANDOFF.md
          CONTEXT.md
          runs/
  framework/
    FRAMEWORK.md
    SECURITY.md
    ENGINEERING.md
    ROLES/
      MAIN.md
      ENGINEER.md
    TEMPLATES/
      TASK.md
      HANDOFF.md
      CONTEXT.md
      RUN-LOG.md
    memory-service/
```

## How To Use It

1. Clone this framework into `workspace/framework/`.
2. Create `projects/`, `memory/`, `ACTIVE-CONTEXT.md`, and `FIXES.md` in the workspace root.
3. Put your workspace `AGENTS.md` in the root.
4. Instruct agents to read the framework files from `framework/` and operate from the workspace root.

Create a simple root `README.md` during workspace setup that explains:
- what the workspace is for
- what lives in `projects/`
- the repository boundaries when the workspace, framework, and projects use separate repositories

## What The Agent Should Read

At minimum, the agent should read:
- `framework/FRAMEWORK.md`
- `framework/SECURITY.md`
- `framework/ENGINEERING.md`

Then it should read the active workspace files from the root.

## Task Directory Naming

Use a slug for each task directory.

Preferred pattern:
- `[project-id]-[task-slug]`

Examples:
- `nx-013-build-pipeline`
- `api-auth-cleanup`
- `docs-release-prep`

Rules:
- lowercase
- words separated by `-`
- keep it short and descriptive
- include a project/task ID when one exists

## Design Principles

1. Curated markdown is the source of truth for active work.
2. Searchable memory is optional and supports recall, not policy.
3. Code and project knowledge stay together.
4. Every task gets its own directory and handoff files.
5. Tool-specific integrations belong in adapters, not in the framework core.

## Repository Boundaries

Recommended repository model:
- the workspace root is its own git repository
- `framework/` remains its own git repository
- each project under `projects/[name]/` is its own git repository

This keeps workspace coordination files separate from the framework and from project code.

When using this model, the workspace root repository should ignore nested repositories such as `framework/` and `projects/*/`.

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
```
