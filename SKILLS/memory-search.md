# Skill: Memory Search

## Purpose

Use the memory system selectively to recover relevant prior context without turning every run into a full-history read.

## When To Use

- when current markdown files are not enough
- when a past decision, lesson, or implementation detail matters
- when recovering context after a long pause
- when verifying whether a similar issue was solved before

## Recommended Roles

- Overseer
- Builder
- Oracle
- Historian

## Required Inputs

- the question or context gap being answered
- available memory tooling or CLI
- relevant workspace or project scope

## Steps

1. Define the exact context gap before searching.
2. Choose the smallest useful CLI query for that gap:
   - `mem search "query"` for prior discussion or implementation details
   - `mem recent 20` for quick recent catch-up
   - `mem sessions` for recent session discovery with trace hints
   - `mem lessons search "query"` for past mistakes, gotchas, or durable fixes
3. Search for the smallest useful set of prior records.
4. Prefer recent, scoped, and trustworthy results over broad transcript dumps.
5. Extract only the facts that matter to the current run.
6. If the result is durable and important, move it into the right markdown file instead of depending on repeated searches.

## Outputs

- a concise set of recovered facts or prior decisions
- optionally a durable markdown update if the result should persist in current-state files

## Stop Conditions

- the current run has enough recovered context to proceed
- no further broad searching is needed

## Pitfalls / Anti-Patterns

- searching without a clear question
- dumping raw history into the run context
- treating memory as the source of truth for current policy
- failing to promote durable findings into markdown

## Related Files / Tools

- `framework/memory-service/`
- `framework/memory-service/CLI.md`
- `FIXES.md`
- `projects/[name]/library/*.md`
