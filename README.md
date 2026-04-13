# Portable Agent Framework

Minimal, agent-agnostic framework for AI-assisted software development.

This directory is meant to be copied into the root of a new workspace so agents can read the markdown files directly from that root context.

## Intended Use

1. Copy these markdown files into a new workspace root.
2. Create `projects/` in that same root.
3. Run your AI agents from the workspace root.
4. Let the agents read these files as their operating framework.

## What To Copy

Copy these files and directories into the new workspace root:
- `FRAMEWORK.md`
- `SECURITY.md`
- `ENGINEERING.md`
- `ROLES/`
- `TEMPLATES/`
- optionally `memory-service/`

Then create:
- `ACTIVE-CONTEXT.md`
- `FIXES.md`
- `memory/`
- `projects/`

## Recommended Workspace Shape

```text
workspace/
  FRAMEWORK.md
  SECURITY.md
  ENGINEERING.md
  ACTIVE-CONTEXT.md
  FIXES.md
  memory/
    daily-brief-YYYY-MM-DD.md
  ROLES/
    MAIN.md
    ENGINEER.md
  TEMPLATES/
    TASK.md
    HANDOFF.md
    CONTEXT.md
    RUN-LOG.md
  projects/
    my-project/
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
        release-prep/
          TASK.md
          HANDOFF.md
          CONTEXT.md
          runs/
```

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
5. Tool-specific integrations belong in adapters, not in the core framework.
