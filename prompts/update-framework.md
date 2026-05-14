---
description: Use the framework update-framework skill to align this workspace with the installed framework
argument-hint: "[instructions]"
---
Use the framework from this workspace as Overseer or Historian.

Invoke `framework/SKILLS/update-framework/SKILL.md` and follow its safety and merge rules. Treat this as an already framework-managed workspace unless the files show otherwise. If the user is asking to update to the latest framework version, start by checking the `framework/` git state and pulling the latest framework repo changes through the normal safe git flow.

Additional instructions, if provided: $ARGUMENTS

Before editing, inspect the current workspace files and repository boundaries. Ask before any ambiguous merge or risky/destructive action. After meaningful work, update the relevant handoff/context files and today's daily brief according to the framework rules.
