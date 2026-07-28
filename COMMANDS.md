# Native Framework Commands

This framework can be used through normal prompts, but several tools also support native slash/prompt commands. Keep these commands transparent: each should expand to an inspectable prompt that names the role, skill, context expectations, and safety gates.

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

Prefer prompts that tell the agent to follow `framework/FRAMEWORK.md` and `framework/SECURITY.md`, plus `framework/ENGINEERING.md` before implementation changes, rather than duplicating the whole framework in every command.

## First Command Set

The first portable commands are intentionally small:

- `next-best-actions` — high-value because it is the common entry point for resuming or prioritizing work.
- `no-context` — answer a bounded request with no framework reads and no framework-managed state writes.
- `scout` — search bounded workspace history and return a compact, source-linked context packet.
- `slc` — shape product concepts, design/architecture specs, and implementation slices as Simple, Lovable, and Complete before execution.
- `update-framework` — high-value because framework-managed workspaces need a repeatable update/alignment flow with merge safety.
- `workspace-maintenance` — high-value because it captures recurring Historian cleanup without implying project-code changes.

More commands can be added later once these prove useful. Good candidates include `task-pickup`, `review-and-test`, and `task-closure`.

## Canonical Command Files

This repository ships the command bodies once, as plain Markdown in [`prompts/`](prompts/). Every supported tool consumes these same files, so behavior lives in one place and changes ship with normal framework updates.

| Command | File | Invoke as |
| --- | --- | --- |
| next-best-actions | [`prompts/next-best-actions.md`](prompts/next-best-actions.md) | `/next-best-actions` |
| no-context | [`prompts/no-context.md`](prompts/no-context.md) | `/no-context` |
| scout | [`prompts/scout.md`](prompts/scout.md) | `/scout` |
| slc | [`prompts/slc.md`](prompts/slc.md) | `/slc` |
| update-framework | [`prompts/update-framework.md`](prompts/update-framework.md) | `/update-framework` |
| workspace-maintenance | [`prompts/workspace-maintenance.md`](prompts/workspace-maintenance.md) | `/workspace-maintenance` |

Each file uses YAML frontmatter (`description`, `argument-hint`) and reads user input from `$ARGUMENTS`. The files are plain Markdown, so inspect and modify any command before invoking it.

## Installing Into a Tool

Every supported tool loads commands from a directory of Markdown files; installation only points that directory at the shipped `prompts/` files. Symlinks keep the directory tracking the installed `framework/prompts/`, so prompt changes arrive with normal framework updates. Copies are more Windows-friendly but do not auto-update — re-copy after framework updates.

Pi, OpenCode, and Claude Code read commands from a **workspace** directory two levels below the root, so the same relative setup works for all three — only the directory name changes:

```bash
DIR=.claude/commands   # or .pi/prompts, or .opencode/commands
mkdir -p "$DIR"
for f in next-best-actions no-context scout slc update-framework workspace-maintenance; do
  ln -s "../../framework/prompts/$f.md" "$DIR/$f.md"
done
```

Copy fallback:

```bash
mkdir -p "$DIR" && cp framework/prompts/*.md "$DIR/"
```

Before installing either way, inspect the target directory first. Do not overwrite same-name local commands unless the Operator explicitly wants framework commands to replace them; the `ln -s` form intentionally fails when a target already exists. Preserve unrelated adapter state the installation flow manages, such as Claude Code's `.claude/skills/` and `CLAUDE.md`.

## Supported Tools

These commands are meant to run in a workspace that has the framework installed, so the setup targets each tool's **workspace** command directory (the symlink resolves the installed `framework/prompts/`). Each tool also has a user/global command directory, but that is out of scope here.

| Tool | Workspace command directory | Notes |
| --- | --- | --- |
| Pi | `.pi/prompts/` | Frontmatter provides `description`; args as `$ARGUMENTS`. |
| OpenCode | `.opencode/commands/` | Frontmatter provides `description`; args as `$ARGUMENTS` or positional `$1`, `$2`. Advanced: JSON/JSONC `command` config with `{file:framework/prompts/...}` substitution; leave `opencode.json` unchanged unless the Operator asks. |
| Claude Code | `.claude/commands/` | Frontmatter provides `description` and `argument-hint`; args as `$ARGUMENTS` or positional `$1`, `$2`. The canonical files already use exactly this convention. |

## Safety Rules

- Commands may ask the agent to plan, inspect, or edit, but the agent must still follow the framework security rules.
- Do not create commands that auto-run risky shell commands or destructive updates.
- For setup/update commands, require inspection before edits and ask before ambiguous merges.
- Keep tool-specific command definitions in tool adapters or clearly labeled docs; do not make the core framework depend on one agent client.
