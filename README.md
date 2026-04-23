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
  OPERATOR-NOTES.md
  FIXES.md
  memory/
    daily-brief-YYYY-MM-DD.md
  projects/
    my-project/
      README.md
      library/
        decisions.md
        plans.md
        notes.md
        research.md
        deliverables/
      work/
        nx-013-build-pipeline/
          TASK.md
          HANDOFF.md
          CONTEXT.md
          runs/
          analysis.md
      project/
  framework/
    FRAMEWORK.md
    INSTALLATION.md
    SECURITY.md
    ENGINEERING.md
    ROLES/
      OVERSEER.md
      BUILDER.md
      ORACLE.md
      HISTORIAN.md
    SKILLS/
      update-framework.md
      next-best-actions.md
      task-pickup.md
      review-and-test.md
      memory-search.md
      self-check.md
      project-self-check.md
      docs-sync.md
      task-closure.md
    TEMPLATES/
      TASKS/
        TASK.md
        HANDOFF.md
        CONTEXT.md
        RUN-LOG.md
      WORKSPACE/
        .gitignore
        README.md
        AGENTS.md
        ACTIVE-CONTEXT.md
        OPERATOR-NOTES.md
        FIXES.md
    memory-service/
```

## How To Use It

1. Clone this framework into `workspace/framework/`.
2. Follow `framework/INSTALLATION.md` to create or adopt the needed workspace files in the current root.
3. Use templates under `framework/TEMPLATES/WORKSPACE/` for workspace-level files and `framework/TEMPLATES/TASKS/` for task files.
4. Instruct agents to read the framework files from `framework/` and operate from the workspace root.

`framework/INSTALLATION.md` is the main adoption guide for both fresh workspaces and already-active/non-empty workspaces.
Incremental adoption is normal: the framework does not require everything to start from a clean slate in one step.

## What The Agent Should Read

At minimum, the agent should read:
- `framework/FRAMEWORK.md`
- `framework/SECURITY.md`
- `framework/ENGINEERING.md`
- the active role file under `framework/ROLES/`

For first-time setup or adoption runs, use:
- `framework/INSTALLATION.md`

For later framework-alignment runs in an already framework-managed workspace, also use:
- `framework/SKILLS/update-framework.md`

Then it should read the active workspace files from the root.
`OPERATOR-NOTES.md` is used as a durable Operator-maintained list of human todos and ideas; agents should treat it as a reference file unless the workspace rules explicitly allow appending short Operator-action items.
Load skills under `framework/SKILLS/` only when they are relevant to the current run.

If current markdown files are not enough to answer a specific context question, load `framework/SKILLS/memory-search.md` and use the optional memory CLI under `framework/memory-service/` selectively (for example: `mem search`, `mem recent`, `mem sessions`, `mem lessons search`).

When implementation work benefits from explicit review, use the Builder–Oracle loop rather than relying on vague completion claims.

When uncertainty blocks progress, escalate one level up: worker → Overseer, Overseer → Operator.

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
4. Every task gets its own directory and handoff files, but task directories may also contain additional working files when useful.
5. Tool-specific integrations belong in adapters, not in the framework core.
6. Roles define mindset and scope; skills define optional procedural playbooks.
7. Review loops and documentation hygiene should stay lightweight and explicit.
8. Polished reusable project outputs may live under `projects/[name]/library/deliverables/` when that helps keep final artifacts separate from general notes.

## Repository Boundaries

Recommended default repository model:
- the workspace root is its own git repository for workspace and project-coordination files
- `framework/` remains its own git repository
- `projects/[name]/project/` is the actual software project and is expected to be its own git repository in the default setup
- `projects/[name]/library/` and `projects/[name]/work/` belong to the workspace root repo by default

This keeps the coordination model lightweight while preserving a clean boundary for project code in the default setup.

If you are adopting the framework into a non-empty workspace, use `framework/INSTALLATION.md` for the phased adoption path, repo-boundary checklist, and root `.gitignore` guidance.

If a team wants isolated git history for non-code coordination files too, separate per-project coordination repos are still possible as an advanced optional pattern rather than the default.

Example root `.gitignore` for the default model:

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
```
