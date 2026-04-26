---
name: self-check
description: "Keep workspace-level coordination files healthy, current, and concise."
---

# Skill: Self-Check

## Purpose

Keep workspace-level coordination files healthy, current, and concise.

## When To Use

- at the end of a meaningful session
- when workspace state feels stale or bloated
- before handing work off
- during maintenance sessions

## Recommended Roles

- Overseer
- Historian

## Required Inputs

- `ACTIVE-CONTEXT.md`
- today's daily brief
- `FIXES.md` when a durable workaround or lesson appeared
- workspace git status when relevant

## Steps

1. Check whether `ACTIVE-CONTEXT.md` still reflects the current priority and active tasks.
2. Summarize or remove stale detail instead of preserving old status verbatim.
3. Check whether the day’s meaningful work has been recorded in the daily brief.
4. If a non-obvious bug, mistake, or durable workaround appeared, record it in `FIXES.md`.
5. If root `SKILLS/` exists, check for workspace-custom skill name collisions with framework skills under `framework/SKILLS/`; if a collision exists, record it as a cleanup item and ask the Operator whether to rename the local skill or treat it as an explicit override.
6. Check for uncommitted changes if session workflow expects clean repo state.
7. Leave the workspace easier for the next run to recover.

## Outputs

- current, concise workspace coordination files
- durable fixes captured when relevant

## Stop Conditions

- workspace state is accurate enough for the next session to recover quickly
- stale detail has been summarized or removed

## Pitfalls / Anti-Patterns

- letting `ACTIVE-CONTEXT.md` become a historical dump
- recording temporary details in durable files
- ending a meaningful session without updating shared state
- letting workspace-custom skills accidentally shadow framework skills without an explicit Operator decision

## Related Files / Tools

- `ACTIVE-CONTEXT.md`
- `memory/daily-brief-YYYY-MM-DD.md`
- `FIXES.md`
