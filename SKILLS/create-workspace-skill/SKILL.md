---
name: create-workspace-skill
description: "Create a workspace-custom skill that extends the framework for local workflows without changing the reusable framework."
---

# Skill: Create Workspace Skill

## Purpose

Create a workspace-custom skill for a local workflow, project, or operating convention without adding niche behavior to the reusable framework.

## When To Use

- a workflow is useful in this workspace but not clearly general enough for the framework
- a project has repeated local release, review, planning, or maintenance steps
- the Operator wants to test a skill before proposing it as a framework skill
- a local convention needs to be discoverable by agents across future sessions

## Recommended Roles

- Overseer
- Historian
- Builder, when implementing an approved local skill

## Required Inputs

- `framework/SKILLS/INDEX.md`
- existing workspace skill index if present: `SKILLS/INDEX.md`
- `AGENTS.md`
- relevant workspace/project files for the local workflow
- Operator intent or task acceptance criteria for the skill

## Workspace Skill Convention

Workspace-custom skills live at the workspace root:

```text
SKILLS/[skill-name]/SKILL.md
```

The workspace skill index lives at:

```text
SKILLS/INDEX.md
```

Use the same basic format as framework skills:

```yaml
---
name: skill-name
description: "One-sentence summary of when this local skill helps."
---
```

`SKILL.md` must remain enough to understand and use the skill without custom tooling.
Optional `resources/`, `scripts/`, or `artifacts/` directories are allowed only when they clearly reduce repeated work or keep `SKILL.md` concise.
Review any script before running it and follow `framework/SECURITY.md`.

## Steps

1. Confirm the skill should be workspace-custom rather than a framework skill.
   - Prefer workspace-custom when the workflow is local, experimental, project-specific, or not yet proven broadly useful.
   - Prefer framework skill only when the workflow is reusable across many framework-managed workspaces.
2. Choose a concise kebab-case skill name.
3. Check for name collisions before creating files:
   - compare against `framework/SKILLS/INDEX.md` and existing `framework/SKILLS/[skill-name]/` directories;
   - compare against `SKILLS/INDEX.md` and existing `SKILLS/[skill-name]/` directories;
   - if the name collides with a framework skill, propose a distinct local name to the Operator instead of shadowing it;
   - if a workspace skill with the same name already exists, update it only when that is explicitly intended.
4. Define:
   - purpose
   - when to use
   - recommended roles
   - required inputs
   - steps
   - outputs
   - stop conditions
   - pitfalls or anti-patterns
5. Create `SKILLS/[skill-name]/SKILL.md` with minimal frontmatter.
6. Create optional supporting directories only when justified:
   - `resources/` for reference material loaded only when needed
   - `scripts/` for reviewed deterministic helpers
   - `artifacts/` for reusable examples, templates, or generated outputs
7. Create or update `SKILLS/INDEX.md` so agents can discover the local skill.
8. If the workspace `AGENTS.md` does not mention workspace-custom skills, add concise guidance to read `SKILLS/INDEX.md` when local skills may be relevant.
9. If the skill captures durable project knowledge, also update the relevant project `library/` files.
10. Record the change in the daily brief or task run log when meaningful.

## Outputs

- `SKILLS/[skill-name]/SKILL.md`
- updated `SKILLS/INDEX.md`
- updated `AGENTS.md` only when discovery guidance is missing
- task/run/daily-brief updates when meaningful

## Stop Conditions

- the skill is discoverable from `SKILLS/INDEX.md`
- the skill is clearly local to the workspace or explicitly marked as an experiment
- agents can use the skill without reading unrelated workspace history
- optional resources/scripts/artifacts are either absent or justified

## Pitfalls / Anti-Patterns

- adding workspace-specific behavior to the reusable framework too early
- creating a skill for a one-time todo instead of a repeated workflow
- copying private workspace details into framework files
- adding scripts when a short checklist is enough
- shadowing a framework skill with a workspace skill of the same name
- forgetting to update `SKILLS/INDEX.md`

## Related Files / Tools

- `SKILLS/INDEX.md`
- `AGENTS.md`
- `framework/SKILLS/INDEX.md`
- `framework/SECURITY.md`
