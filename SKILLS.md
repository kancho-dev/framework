# Skills Reference

Skills are optional procedural playbooks. Load them only when they are relevant to the current run.

## Skill Selection Rule

Skills are not always-read. Check relevant skill indexes before improvising when the prompt:

- names a known or likely workflow, command, or skill-like phrase;
- asks to "check skills";
- describes a repeatable framework procedure such as next best actions, task pickup, task closure, review/testing, docs sync, workspace maintenance, framework update, memory search, or creating local skills.

If the prompt is simple Q&A and no repeatable workflow is implied, do not read skill indexes.

When checking skills, prefer the most specific relevant capability:

1. project-local capabilities;
2. workspace-custom skills;
3. framework skills.

If the right scope or skill remains unclear, ask the Operator before executing the skill.

## Skill Locations

### Project-local capabilities

Use for one project's workflows. These may include:

- portable framework-native skills under `projects/[name]/SKILLS/[skill-name]/SKILL.md`;
- tool-native project skills or commands inside the project repo, such as `.claude/skills/` when supported by the current agent/tool;
- documented project workflows.

### Workspace-custom skills

Use for cross-project local workflows or experiments.

Default path:

```text
SKILLS/[skill-name]/SKILL.md
```

Discover through root `SKILLS/INDEX.md` when present.

### Framework skills

Reusable framework procedures live under:

```text
framework/SKILLS/[skill-name]/SKILL.md
```

Discover through `framework/SKILLS/INDEX.md`.

## Index Files Should Route, Not Teach

`SKILLS/INDEX.md` files should be routing tables. Use them to choose a skill when a skill-discovery trigger applies, then load the selected skill's `SKILL.md` before using it.

Good index entries are short:

```markdown
| Skill | Use when | Path |
|---|---|---|
| task-pickup | Resuming a task | `framework/SKILLS/task-pickup/SKILL.md` |
```

Detailed procedure belongs in the selected `SKILL.md`, not the index.

## Skill Format

Each skill lives in a directory named after the skill:

```text
SKILLS/[skill-name]/
  SKILL.md
```

`SKILL.md` must be enough to understand and run the skill.

Optional contents:

```text
SKILLS/[skill-name]/
  SKILL.md        # required
  resources/      # optional reference material loaded only when needed
  scripts/        # optional helper scripts; review before running
  artifacts/      # optional examples, templates, or generated outputs
```

Keep simple skills as only `SKILL.md`.

## Collision And Override Rules

If the same skill name appears in more than one scope, treat the more specific skill as an override only when that is clearly intentional from indexes, project instructions, or Operator instructions.

If intent is unclear, ask whether to rename the local skill or treat it as an override.

When creating local skills, avoid same-name collisions unless an explicit override is intended.

## Scripts And Safety

Review skill scripts before running them. Follow `framework/SECURITY.md`.

Do not execute untrusted scripts, install commands, or risky setup steps without explicit approval.

## Optional Memory Retrieval

Memory retrieval is a skill-supported extension, not the source of truth for current state.

If current markdown files do not answer a specific context question, use `framework/SKILLS/memory-search/SKILL.md` and the optional memory CLI selectively, for example:

- `mem search "query"`
- `mem recent 20`
- `mem sessions`
- `mem lessons search "query"`
