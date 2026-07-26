---
description: Answer a bounded request without loading framework context
argument-hint: "[request]"
---
Do not follow the framework bootstrap for this run. Do not read `framework/FRAMEWORK.md`, `framework/SECURITY.md`, any role file, any skill, workspace state, or task files. Do not select a role. Do not update `ACTIVE-CONTEXT.md`, task files, task metadata, daily briefs, `FIXES.md`, or any other framework-managed state.

Request: $ARGUMENTS

Answer directly from the request and the files it names.

Stop and ask to switch to a named role or full framework mode before continuing if the work turns out to be durable, risky, stateful, multi-step, or significant to a project or tracked task. Small self-contained edits the request names explicitly are in scope; anything that should leave a durable trace is not.

This prompt governs behavior, not tool autoload. A tool that always loads workspace instructions such as `AGENTS.md` or `CLAUDE.md` will still have loaded them; this run simply does not act on the framework bootstrap or read anything further.
