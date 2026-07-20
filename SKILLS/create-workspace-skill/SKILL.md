---
name: create-workspace-skill
description: "Assess, create, or update workspace-custom skills for repeated local workflows without changing the reusable framework."
---

# Skill: Create Workspace Skill

## Purpose

Develop workspace-custom skills under root `SKILLS/` through one checkable procedure while keeping one-project behavior with its project and declining candidates that do not justify a reusable local skill.

## Use When

- assessing whether a candidate belongs at workspace scope;
- creating a workspace-custom skill;
- updating an existing workspace-custom skill or its routing.

Use project-local conventions when only one project needs the workflow. Use ordinary documentation, a task checklist, or direct work when the candidate is one-off or has no stable repeatable procedure.

## Authoring Standard

Apply these rules to the skill being authored:

- **Predictable path:** express consequential work as ordered gates with observable completion criteria.
- **Reliable routing:** the index says when to load the skill; `SKILL.md` owns the procedure.
- **Branch-driven context:** load a reference only when its branch requires it.
- **Local completion:** place each check beside the action it verifies.
- **Single source of truth:** keep each rule authoritative in one location and use links or short routing summaries elsewhere.
- **Positive steering:** state the target action; retain explicit prohibitions for security and repository boundaries.
- **Pruning:** remove sections, inputs, and repeated wording that do not change execution.

A workspace skill needs minimal YAML frontmatter (`name` and routing-oriented `description`) and enough structure to execute its declared branches. Add roles, outputs, examples, resources, scripts, or artifacts only when they change execution or verification.

## Inputs

Always read:

- workspace `AGENTS.md` for local boundaries and instructions;
- `framework/SKILLS.md` for precedence, collisions, format, and safety rules;
- the workspace `SKILLS/INDEX.md` when present, plus only relevant entries from `framework/SKILLS/INDEX.md` and project-local indexes.

Then load only the applicable branch:

| Branch | Additional input |
|---|---|
| Tracked task | Its task files and one-time Steering Notes handling through `task-pickup` |
| Assess | Operator intent, repetition evidence, expected users, inputs, and portability constraints |
| Create | Source workflow files and the smallest related capabilities needed for overlap checks |
| Update | Existing skill, its routing entries, usage evidence, and references found by focused search |
| Script | `framework/SECURITY.md`, then the complete script before execution |
| Discovery behavior changes | Affected `AGENTS.md`, templates, or local guidance |

## Procedure

### 1. Pass the scope gate

Classify the candidate as **project-local**, **workspace-custom**, or **no skill** and record the rationale, compared capabilities, collision result, and destination in task state or the run log.

Choose workspace-custom when the workflow is repeated or expected to recur across projects or sessions in this workspace and depends on local context or conventions. Route one-project workflows to that project's supported capability location. Choose no skill for a one-time task, an unstable process without a repeatable contract, or knowledge better kept in ordinary documentation; record the lighter destination and stop without creating skill files.

For an assess-only run, stop after recording the recommendation and evidence. For create or update, continue only with a workspace-custom classification. The gate is complete when scope, rationale, comparisons, collision/override intent, destination, and branch are explicit.

### 2. Define the execution contract

Record the supported branch or branches, trigger language, required outcome, authoritative file, branch-specific inputs, and observable completion checks. For an update, identify the exact contract being changed and evidence that the update is intentional.

Choose a concise kebab-case name. Search project-local, workspace, and framework indexes and skill directories for that name. A same-name workspace skill selects the update branch only when the requested change is explicit. Escalate an unresolved collision or override decision to the Operator.

The contract is complete when another agent can determine when to invoke the skill, which branch to take, what to load, where authority lives, and what evidence ends the branch.

### 3. Implement the workspace skill

Create or edit:

```text
SKILLS/[skill-name]/SKILL.md
```

Keep the file self-contained for normal execution, with minimal frontmatter and ordered, branch-complete instructions. Add supporting files only when they remove substantial complexity and `SKILL.md` states when to load or run them:

```text
SKILLS/[skill-name]/
  SKILL.md
  resources/   # disclosed reference
  scripts/     # reviewed deterministic helpers
  artifacts/   # reusable examples or templates
```

Keep workspace-specific implementation out of installed `framework/`. Move a one-project implementation to the relevant project-local capability. For a no-skill result, use the lighter destination recorded at the scope gate.

Implementation is complete when every declared branch is executable from the edited files, optional files have an explicit loading condition, and non-operative or repeated text has been removed.

### 4. Align routing and affected guidance

Create or update the single routing row in `SKILLS/INDEX.md`. Search local indexes, `AGENTS.md`, templates, and references for the skill name, old triggers, and changed paths. Update only guidance made inaccurate by the new contract; point to the skill instead of duplicating its procedure.

If the workflow establishes durable project facts, place those facts in the relevant project `library/` and keep only the procedural pointer in the skill.

This gate is complete when every supported branch is discoverable, the procedure has one authoritative home, and focused search finds no unexplained stale or competing guidance.

### 5. Inspect the bounded change

List every added or modified skill, routing, guidance, resource, script, and artifact file. Inspect each for secrets, credentials, unsafe commands, unintended personal data, and accidental edits under installed `framework/`. Workspace-local references may remain private when they are necessary and comply with workspace policy.

Review every script completely before executing it. Ask before destructive, risky, irreversible, installation, or untrusted setup actions.

This gate passes when every changed file and every safety category has been checked, script provenance and execution decisions are recorded, and the diff contains only the intended workspace slice.

### 6. Validate representative branches

Walk through each affected branch with concrete inputs without creating unrelated files merely for the walkthrough. Confirm classification, routing, loaded inputs, declared outcome, and completion evidence.

Run focused searches for stale routing, changed paths, and duplicated procedure. Run the workspace's applicable checks, including `git diff --check` from the repository that owns the changed files, then inspect the complete focused diff. Add executable tests only when scripts or code change.

Validation is complete when every affected branch reaches its declared outcome without unstated inputs, checks pass, searches have no unexplained matches, and the recorded diff review covers correctness, pruning, safety, and scope.

### 7. Record and hand off

Record the classification, changed files, validation evidence, remaining risks, and any version policy that applies to the owning workspace or project. Workspace-custom skills are not assigned a framework version merely because they exist locally.

For tracked work, update task state and request the required review. The gate is complete when durable state matches the files and the next actor can continue without reconstructing the run.

## Completion Gate

Treat the workspace-skill change as ready only when the scope, contract, implementation, routing, safety, validation, and handoff gates each have recorded evidence. Treat tracked work as complete only after its required review and workspace/task state alignment.
