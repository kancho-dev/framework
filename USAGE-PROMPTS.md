# Useful Framework Prompts

These are practical prompts you can give an agent while working in a framework-managed workspace.

You do not need to know every framework detail before using it. Ask for the outcome you want, and mention a role or skill when it helps.

## Getting Unstuck

```text
Use the `next-best-actions` skill and tell me what we should do next
```

```text
I’m not sure how to proceed on project X. Use the framework and recommend the next step
```

```text
Act as Overseer and decide whether this should be direct work, a new task, or a review loop
```

## Creating Projects And Tasks

```text
Create a new project named X
```

```text
Create a new task in project X for Y
```

```text
Turn this idea into a small framework task and create the task files
```

```text
Break this larger goal into a few small tasks and recommend which one to do first
```

## Resuming Work

```text
Pick up task X using the `task-pickup` skill
```

```text
Read the task handoff and continue from where the last session stopped
```

```text
Summarize the current state of task X before making changes
```

## Building, Reviewing, And Closing Work

```text
Act as Builder and implement the agreed slice
```

```text
Use `review-and-test` skill to review this implementation
```

```text
Act as Oracle and review the task against its acceptance criteria
```

```text
I think this task may be done. Use `task-closure` and check
```

```text
If the task is done, update the handoff and daily brief appropriately
```

```text
Before we stop, update the relevant handoff/context files and the daily brief
```

## Workspace And Project Maintenance

```text
Use `self-check` skill to inspect the workspace for stale or inconsistent state
```

```text
Use `project-self-check` skill on project X
```

```text
Use `docs-sync` skill to check whether docs and task state have drifted
```

```text
Act as Historian and clean up stale state/docs without changing project code
```

```text
Use `update-framework` skill to sync framework updates into this workspace
```

## Planning And Prioritization

```text
Use the framework as Overseer and make a short plan for project X
```

```text
Break this idea into one or more tasks with acceptance criteria
```

```text
Review the active project plans and recommend the next useful implementation slice
```

```text
Decide whether this work needs a Builder–Oracle review loop
```

## Optional Memory Search

Use memory search only when current markdown files are not enough.

```text
Use `memory-search` skill to look for prior context about X
```

```text
Use the `mem` tool to find recent discussion about this task and summarize only the parts still relevant now
```

## Role Shortcuts

```text
Act as Overseer and plan, route, prioritize, or update workspace direction
```

```text
Act as Builder and implement the agreed work
```

```text
Act as Oracle and review or verify the result
```

```text
Act as Historian and clean up documentation, summaries, or state hygiene
```
