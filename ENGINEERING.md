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
