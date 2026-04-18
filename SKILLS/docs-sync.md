# Skill: Docs Sync

## Purpose

Update documentation so it matches the actual implemented or current project state.

## When To Use

- after meaningful implementation milestones
- when docs and code or current behavior have drifted apart
- during Historian-style maintenance passes

## Recommended Roles

- Historian
- Builder, when documentation is part of the current task scope

## Required Inputs

- the docs to update
- the current implementation or actual behavior they describe
- task handoff/context when recent changes matter

## Steps

1. Identify which docs are intended to describe the current reality.
2. Verify the actual implementation or current project state before editing.
3. Update the smallest set of docs needed to restore accuracy.
4. Prefer concise factual updates over broad rewrites.
5. If the change reveals a durable project fact or decision, update the appropriate library file too.

## Outputs

- documentation that better matches current reality
- any related durable notes moved into the correct knowledge files

## Stop Conditions

- the targeted docs no longer contradict the actual project state
- unnecessary rewrite was avoided

## Pitfalls / Anti-Patterns

- rewriting docs speculatively
- preserving outdated docs because they are long-standing
- mixing temporary task state into durable docs

## Related Files / Tools

- `projects/[name]/project/README.md`
- `projects/[name]/library/*.md`
- task handoff/context files when recent implementation changes matter
