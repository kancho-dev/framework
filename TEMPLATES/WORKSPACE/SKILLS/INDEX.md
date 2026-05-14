# Workspace Skills Index

Use this index to choose workspace-custom skills. Do not load every skill by default.

Workspace-custom skills live at:

```text
SKILLS/[skill-name]/SKILL.md
```

Project-local capabilities and framework skills live separately. Project-local capabilities may include framework-native skills, tool-native skills/commands, or documented project workflows, for example:

```text
projects/[name]/SKILLS/[skill-name]/SKILL.md
projects/[name]/project/.claude/skills/[skill-name]/...
framework/SKILLS/[skill-name]/SKILL.md
```

Use local-capability precedence: project-local → workspace → framework. Use project-local capabilities for one project's workflows, workspace-custom skills for cross-project local workflows or experiments, and framework skills for reusable framework procedures.

Avoid giving local skills the same name as skills in another scope unless an explicit override is intended. If a collision exists and intent is unclear, ask the Operator whether to rename the local skill or treat it as an override.

## Skills

- Add workspace-custom skills here as they are created.
