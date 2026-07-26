# Task Browser Metadata CLI

Non-interactive metadata reads and writes for agents. Task markdown remains the source of truth; this CLI only maintains task-browser workflow metadata.

Framework `TASKS.md` owns lifecycle status semantics and the `nextActor` matrix. For UI behavior, metadata history, storage paths, and privacy notes, see `README.md` in this directory.

## Commands

Agents must use this dependency-free CLI for non-interactive metadata updates:

```bash
node tools/task-browser/metadata-cli.mjs list --status active
node tools/task-browser/metadata-cli.mjs get '#32'
node tools/task-browser/metadata-cli.mjs key '#32'
node tools/task-browser/metadata-cli.mjs init agent-framework/task-browser-metadata-guidance-rules --status planned --priority high --type documentation
node tools/task-browser/metadata-cli.mjs set '#32' --status review --priority high --tags task-browser,metadata-guidance
node tools/task-browser/metadata-cli.mjs set '#32' --next-actor agent --role Builder --session-tool pi
node tools/task-browser/metadata-cli.mjs clear '#32' --next-actor
node tools/task-browser/metadata-cli.mjs set '#32' --status review --role Builder --session-tool pi --session-id pi-session-id
node tools/task-browser/metadata-cli.mjs history '#32' --limit 10
node tools/task-browser/metadata-cli.mjs clear '#32' --order
node tools/task-browser/metadata-cli.mjs add-related '#32' agent-framework/task-browser-prompt-copy-v2
node tools/task-browser/metadata-cli.mjs add-blocker '#32' '#12'
node tools/task-browser/metadata-cli.mjs set-parent '#32' agent-framework/task-browser-prompt-copy-v2
```

## Task References

The CLI accepts display IDs and canonical task keys for task references. Relationship fields are stored as canonical task keys so browser relationship links remain reliable. Parent/child commands maintain reciprocal `parent`/`children` metadata from either side, and `related` commands maintain symmetric links. `blockedBy` is for existing task blockers only; generic blockers should be explained in `HANDOFF.md`, `CONTEXT.md`, or run logs while metadata uses `status: blocked`. The inverse `blocks` relationship is derived from other tasks' `blockedBy` metadata instead of stored separately.

## Fields And Provenance

Supported CLI metadata fields are `status`, `priority`, `type`, `nextActor`, `order`, `parent`, `tags`, `blockedBy`, `children`, and `related`. Use `set --next-actor operator|agent` to assign responsibility and `clear --next-actor` to store `null`. CLI `get` and `list` expose the normalized value. Identity fields such as `displayId`, `project`, `slug`, and `path` are preserved.

Write commands accept optional provenance flags `--actor`, `--role`, `--session-tool`, `--session-id`, and `--note`; agents should pass real role/session details when useful and available rather than inventing them.

In framework versions with task-browser action history, write commands append local `.tools-config/task-browser/task-history.jsonl` events by default for actual durable metadata changes.
