# Native Framework Commands

This framework can be used through normal prompts, but some tools also support native slash/prompt commands. Keep these commands transparent: they should expand to inspectable prompts that name the role, skill, context expectations, and safety gates.

## Command Model

Each framework command should specify:

- **name**: the slash/command name exposed by the tool;
- **purpose**: the outcome the user is asking for;
- **role**: the framework role to use, when one is preferred;
- **skill**: the framework skill to invoke, if any;
- **context**: required reads or the rule for choosing minimal context;
- **arguments**: what user-provided text means;
- **safety**: approval gates for edits, commands, risky operations, or ambiguous merges;
- **output**: the expected summary or artifact.

Prefer prompts that tell the agent to follow `framework/FRAMEWORK.md`, `framework/SECURITY.md`, and `framework/ENGINEERING.md` rather than duplicating the whole framework in every command.

## First Command Set

The first portable commands are intentionally small:

- `next-best-actions` — high-value because it is the common entry point for resuming or prioritizing work.
- `update-framework` — high-value because framework-managed workspaces need a repeatable update/alignment flow with merge safety.
- `workspace-maintenance` — high-value because it captures recurring Historian cleanup without implying project-code changes.

More commands can be added later once these prove useful. Good candidates include `task-pickup`, `review-and-test`, and `task-closure`.

## Pi Prompt Templates

Pi supports native prompt templates loaded from `~/.pi/agent/prompts/*.md`, workspace `.pi/prompts/*.md`, package `prompts/` directories, configured `prompts` entries, or repeated `--prompt-template <path>` flags.

This repository ships Pi-compatible templates in [`prompts/`](prompts/):

- [`prompts/next-best-actions.md`](prompts/next-best-actions.md) -> `/next-best-actions`
- [`prompts/update-framework.md`](prompts/update-framework.md) -> `/update-framework`
- [`prompts/workspace-maintenance.md`](prompts/workspace-maintenance.md) -> `/workspace-maintenance`

To use them in one workspace, symlink or copy the files into `.pi/prompts/` at the workspace root, or configure Pi to load this repository's `prompts/` directory. The files are plain Markdown so users can inspect and modify the behavior before invoking them.

Recommended Linux/macOS symlink setup from the workspace root:

```bash
mkdir -p .pi/prompts
ln -s ../../framework/prompts/next-best-actions.md .pi/prompts/next-best-actions.md
ln -s ../../framework/prompts/update-framework.md .pi/prompts/update-framework.md
ln -s ../../framework/prompts/workspace-maintenance.md .pi/prompts/workspace-maintenance.md
```

Symlinks keep `.pi/prompts/` pointed at the installed `framework/prompts/` files, so command prompt changes arrive with normal framework updates. If symlinks are not supported or are undesirable, use the copy fallback:

```bash
mkdir -p .pi/prompts
cp framework/prompts/*.md .pi/prompts/
```

Copied prompts are simpler and more Windows-friendly, but they do not update automatically when `framework/prompts/` changes. Re-copy them after framework updates when needed.

Before installing either way, inspect existing `.pi/prompts/` files. Do not overwrite same-name local prompts unless the Operator explicitly wants framework prompts to replace them. The `ln -s` commands above intentionally fail when a target file already exists.

## OpenCode Commands

OpenCode supports native Markdown commands in workspace `.opencode/commands/` and global `~/.config/opencode/commands/`. The Markdown body is the command template, frontmatter can provide metadata such as `description`, and arguments are available as `$ARGUMENTS` or positional variables like `$1` and `$2`.

Use the same canonical templates from [`prompts/`](prompts/) for OpenCode unless a local OpenCode version rejects a frontmatter field. Recommended Linux/macOS symlink setup from the workspace root:

```bash
mkdir -p .opencode/commands
ln -s ../../framework/prompts/next-best-actions.md .opencode/commands/next-best-actions.md
ln -s ../../framework/prompts/update-framework.md .opencode/commands/update-framework.md
ln -s ../../framework/prompts/workspace-maintenance.md .opencode/commands/workspace-maintenance.md
```

Copy fallback:

```bash
mkdir -p .opencode/commands
cp framework/prompts/*.md .opencode/commands/
```

OpenCode also supports JSON/JSONC `command` config and `{file:path}` substitution, for example `template: "{file:framework/prompts/next-best-actions.md}"`. Treat that as an advanced adapter option; the default workspace setup should avoid mutating `opencode.json` unless the Operator explicitly asks for it.

Before installing either way, inspect existing `.opencode/commands/` files. Do not overwrite same-name local commands unless the Operator explicitly wants framework commands to replace them. The `ln -s` commands above intentionally fail when a target file already exists.

## Safety Rules

- Commands may ask the agent to plan, inspect, or edit, but the agent must still follow the framework security rules.
- Do not create commands that auto-run risky shell commands or destructive updates.
- For setup/update commands, require inspection before edits and ask before ambiguous merges.
- Keep tool-specific command definitions in tool adapters or clearly labeled docs; do not make the core framework depend on one agent client.
