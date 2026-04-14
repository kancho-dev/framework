# Memory Service Schema

This is the smallest useful schema for agent-assisted development work.

## messages

Stores raw transcript messages.

Suggested fields:
- `id`
- `platform`
- `workspace`
- `session_id`
- `external_id`
- `parent_external_id`
- `role`
- `content`
- `source_type`
- `created_at`
- `imported_at`

## sessions

Stores metadata about each session.

Suggested fields:
- `id`
- `platform`
- `workspace`
- `external_id`
- `session_type`
- `source_path`
- `source_hash`
- `started_at`
- `ended_at`
- `message_count`
- `imported_at`
- `updated_at`

## work_reports

Stores summaries of delegated or recurring work runs.

Suggested fields:
- `id`
- `platform`
- `workspace`
- `project`
- `work_item`
- `session_id`
- `external_id`
- `summary`
- `source_type`
- `created_at`
- `imported_at`

## lessons

Stores durable mistakes, warnings, and non-obvious fixes.

Suggested fields:
- `id`
- `workspace`
- `category`
- `severity`
- `title`
- `description`
- `tags`
- `related_project`
- `related_work_item`
- `created_at`
- `created_by`

## Principle

Keep the schema boring.
If a concept already lives clearly in markdown, do not duplicate it in the database unless search adds real value.
