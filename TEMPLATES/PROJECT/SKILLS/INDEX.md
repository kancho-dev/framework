# Project Skills Index

Use this index to choose project-local framework-native skills for this project. Do not load every skill by default.

Portable project skills may live at:

```text
projects/[name]/SKILLS/[skill-name]/SKILL.md
```

This is not the only valid project-local capability location. A project may also use tool-native skills/commands inside its repo, such as `.claude/skills/`, or documented workflows in project instructions. Use those only when relevant to this project and supported by the current agent/tool.

Workspace-custom and framework skills live separately under:

```text
SKILLS/[skill-name]/SKILL.md
framework/SKILLS/[skill-name]/SKILL.md
```

Use local-capability precedence: project-local → workspace → framework. Use project-local capabilities for this project's workflows, workspace-custom skills for cross-project local workflows or experiments, and framework skills for reusable framework procedures.

Avoid giving local skills the same name as skills in another scope unless an explicit override is intended. If a collision exists and intent is unclear, ask the Operator whether to rename the local skill or treat it as an override.

## Skills

- Add project-specific framework-native skills here as they are created.
