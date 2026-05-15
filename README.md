# Portable Agent Framework

![Version](https://img.shields.io/badge/version-0.8.0-blue)

A minimal, agent-agnostic framework for keeping AI-assisted software development coherent across sessions, tasks, projects, and tools.

The framework uses plain markdown files for active state, project knowledge, task handoffs, and lightweight review loops. Optional tools add search, session browsing, and native command shortcuts when you need them.

## Quick Start

From the root of the workspace where you want to use the framework, ask your coding agent:

```text
Clone https://github.com/kancho-dev/framework.git into this workspace as `framework/`, then read `framework/INSTALLATION.md` and perform the initial framework setup for this workspace.
```

For manual setup or adoption of an already-active workspace, read [`INSTALLATION.md`](INSTALLATION.md).

After setup, ask for the outcome you want, for example:

```text
Use the `next-best-actions` skill and tell me what we should do next.
```

```text
Create a new project named X.
```

```text
Create a new task in project X for Y.
```

For more copy-friendly examples, see [`USAGE-PROMPTS.md`](USAGE-PROMPTS.md).

## What The Framework Gives You

- **Continuity across sessions** — important state is written to files instead of living only in chat history.
- **Project-local knowledge** — plans, decisions, notes, research, and task state stay near the project they describe.
- **Explicit task handoffs** — multi-session work can be resumed without reconstructing everything from memory.
- **Role-based runs** — Overseer, Builder, Oracle, and Historian roles keep planning, execution, review, and cleanup distinct.
- **Optional skills** — procedural playbooks are loaded only when relevant.
- **Lightweight review loops** — Builder/Oracle flow gives meaningful work a concrete quality gate.
- **Tool agnosticism** — the core is markdown-first and does not depend on one agent client, model vendor, or UI.

## Minimum Mental Model

The framework has three layers:

1. **Core workflow** — markdown state, roles, task handoffs, security, and review.
2. **Reference guidance** — installation, usage prompts, skills, task patterns, and workspace structure.
3. **Optional extensions** — session browser, native command adapters, and memory service.

You can start with only the core workflow. Add extensions only when they help your actual process.

## Intended Workspace Layout

The framework is intended to live in the workspace root as `framework/`, next to active workspace files.

Recommended shape:

```text
workspace/
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
        task-slug/
          TASK.md
          HANDOFF.md
          CONTEXT.md
          runs/
      project/
  framework/
    FRAMEWORK.md
    SECURITY.md
    ENGINEERING.md
    ROLES/
    SKILLS/
    TEMPLATES/
    memory-service/
    tools/
```

The default repository model keeps:

- the workspace root as the repo for workspace and project-coordination files;
- `framework/` as its own nested repository;
- `projects/[name]/project/` as the actual software project repository;
- `projects/[name]/library/` and `projects/[name]/work/` in the workspace root repo by default.

See [`INSTALLATION.md`](INSTALLATION.md) for repository-boundary and `.gitignore` guidance.

## Core Workflow

Typical use looks like this:

1. Keep workspace direction in `ACTIVE-CONTEXT.md`.
2. Keep durable project knowledge in `projects/[name]/library/`.
3. Use `projects/[name]/work/[task-slug]/` for multi-session, delegated, risky, or review-heavy work.
4. Use roles to clarify the run:
   - **Overseer** — plan, route, prioritize, review direction.
   - **Builder** — implement a bounded slice.
   - **Oracle** — review and verify.
   - **Historian** — clean up docs and state.
5. Append meaningful progress to `memory/daily-brief-YYYY-MM-DD.md`.
6. Use optional skills and tools only when they fit the run.

## Optional Extensions

### Session Browser

[`tools/session-browser/`](tools/session-browser/) is an optional but high-value local tool for browsing and searching Pi and OpenCode coding-agent sessions.

It can be useful both inside framework-managed workspaces and as a standalone session browser in other directories.

Quick start:

```bash
cd framework/tools/session-browser
npm start
```

Then open:

```text
http://localhost:8787
```

Read [`tools/session-browser/README.md`](tools/session-browser/README.md) for setup, configuration, and safety details.

### Native Commands

[`prompts/`](prompts/) contains optional Pi/OpenCode-compatible command templates such as `/next-best-actions`, `/update-framework`, and `/workspace-maintenance`.

Use [`COMMANDS.md`](COMMANDS.md) if you want native slash-command integration. The framework remains usable through normal prompts without these adapters.

### Memory Service

[`memory-service/`](memory-service/) is an optional searchable recall layer for older sessions, lessons, and imported agent history.

Use it when curated markdown files are not enough for a specific context question. Markdown remains the source of truth for current state, policy, and task handoffs.

## Documentation Map

- [`INSTALLATION.md`](INSTALLATION.md) — first-time setup and existing-workspace adoption.
- [`MIGRATIONS.md`](MIGRATIONS.md) — version-specific checks for updating existing framework-managed workspaces.
- [`FRAMEWORK.md`](FRAMEWORK.md) — compact agent operating protocol.
- [`WORKSPACE.md`](WORKSPACE.md) — workspace files, project structure, repository boundaries, and state placement.
- [`TASKS.md`](TASKS.md) — micro/minimal/full tasks, task files, task patterns, and review loops.
- [`SKILLS.md`](SKILLS.md) — skill resolution, local capability precedence, and skill format guidance.
- [`SECURITY.md`](SECURITY.md) — command/setup safety rules.
- [`ENGINEERING.md`](ENGINEERING.md) — implementation guidance for code and docs changes.
- [`ROLES/`](ROLES/) — role instructions for Overseer, Builder, Oracle, and Historian.
- [`SKILLS/`](SKILLS/) — optional procedural playbooks.
- [`USAGE-PROMPTS.md`](USAGE-PROMPTS.md) — copy-friendly prompt examples.
- [`COMMANDS.md`](COMMANDS.md) — optional native command integration.
- [`memory-service/`](memory-service/) — optional searchable memory CLI/service.
- [`tools/session-browser/`](tools/session-browser/) — optional local session browser.

## Design Principles

1. Curated markdown is the source of truth for active work.
2. Searchable memory supports recall, not policy.
3. Code and project knowledge stay together.
4. Use the smallest task structure that stays consistent.
5. Tool-specific integrations belong in adapters, not in the framework core.
6. Roles define mindset and scope; skills define optional procedures.
7. Review loops and documentation hygiene should stay lightweight and explicit.

## Contributing

Contributions are welcome when they keep the framework portable, lightweight, and safe to share.

Before proposing a change:

- prefer subtraction or simplification over adding new required process;
- keep optional tooling clearly separate from the core workflow;
- avoid committing private workspace state, secrets, transcripts, or client-specific details;
- update related docs/templates when behavior changes;
- include review evidence for meaningful code, tool, or instruction changes.

For substantial changes, open a focused task or issue first so the goal, scope, and acceptance criteria are clear.
