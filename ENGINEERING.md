# Engineering Instructions

Read this file before making code changes.

## Coding Rules

1. Read the relevant code before editing it.
2. Prefer the smallest correct change.
3. Solve the root cause when it is practical to do so.
4. Validate at boundaries and fail fast.
5. Do not hardcode secrets.
6. Add tests for business logic and edge cases where the project supports testing.
7. Keep comments rare and use them to explain why, not what.

## Suggested Limits

Use these as heuristics, not as rigid laws:
- function length: 50 lines
- parameters: 4 max before considering an options object
- nesting depth: 4 levels
- file length: 300 lines

If you break these limits, have a clear reason.

## File Rules

1. Keep one main responsibility per file.
2. Group by feature when the project is large enough.
3. Keep temporary files out of the project root.
4. Use clear, consistent naming.

## DRY In Practice

Use DRY as a practical workspace principle, not as a demand to remove every repeated sentence. The goal is to avoid competing sources of truth during normal project work.

### The Core Concept

DRY applies broadly to the entire development lifecycle, including:
- Business Logic: Centralizing validation so updates are made in a single function rather than multiple files.
- Configuration & UI: Using centralized config files and reusable UI components instead of hardcoding identical settings or styles everywhere.
- Database Schemas: Normalizing data to prevent data redundancy and anomalies.

1. Before changing code, docs, config, tests, task state, or project knowledge, identify what should be authoritative for the behavior, decision, data, or procedure.
2. Update the authoritative source first, then add only the references, summaries, examples, or local reminders needed for people and agents to work reliably.
3. Treat duplicated business logic, validation rules, generated values, schemas, commands, config, status, current task state, and durable project facts as high-risk duplication.
4. For docs-centric work, avoid maintaining the same procedure or decision in multiple places unless one place clearly points to the source of truth.
5. For code-centric work, prefer shared functions, constants, schemas, fixtures, or tests when duplication would make future behavior changes easy to miss.
6. Allow deliberate repetition when it improves clarity, locality, test coverage, onboarding, migration safety, or instruction-following reliability.
7. If duplication remains, make the authoritative copy and the reason for duplication clear enough that future updates do not drift.

## Review Checklist

Before considering a change complete, check:
- does it solve the actual problem?
- is the implementation understandable?
- are errors handled at the right boundary?
- are tests present where the logic matters?
- did the change introduce hidden coupling?

## Secrets

1. Put secrets in environment files or a secret manager.
2. Commit examples, not real secret values.
3. If a secret was committed, rotate it.

## Database Changes

If the project has a database, every schema change should have a migration.
