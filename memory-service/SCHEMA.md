# Memory Service Schema

This is the smallest useful schema for agent-assisted development work.

## messages

Stores raw transcript messages.

Suggested fields:
- `id`
- `platform`
- `workspace`
- `session_id`
- `role`
- `content`
- `source`
- `created_at`

## sessions

Stores metadata about each session.

Suggested fields:
- `id`
- `platform`
- `workspace`
- `session_id`
- `session_type`
- `started_at`
- `ended_at`
- `message_count`

## work_reports

Stores summaries of delegated or recurring work runs.

Suggested fields:
- `id`
- `workspace`
- `project`
- `work_item`
- `session_id`
- `summary`
- `created_at`

## lessons

Stores durable mistakes, warnings, and non-obvious fixes.

Suggested fields:
- `id`
- `category`
- `severity`
- `title`
- `description`
- `tags`
- `related_project`
- `related_work_item`
- `created_at`

## Principle

Keep the schema boring.
If a concept already lives clearly in markdown, do not duplicate it in the database unless search adds real value.
