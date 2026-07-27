---
name: update-framework
description: "Align an already framework-managed workspace with newer framework changes through an approval-gated update plan."
---

# Skill: Update Framework

## Outcome

Produce an evidence-backed update plan, then execute it only after explicit Operator approval. Finish with every changed framework file and workspace adaptation accounted for, validated, and reported.

## Entry Contract

Treat inspection and planning as read-only. Pulls, merges, workspace edits, setup commands, and `CURRENT_VERSION` changes belong to the approval-gated execution branch.

## Inputs

Always inspect:

- `framework/VERSION` and `framework/CURRENT_VERSION` when present;
- framework repository and workspace repository boundaries and working-tree state;
- `framework/INSTALLATION.md`, `framework/README.md`, and the current workspace root;
- the Operator's requested source, target, and scope.

Load only when its branch requires it:

- `framework/MIGRATIONS.md`: its selection rule and index, then every `framework/migrations/vX.Y.Z.md` file it lists between the installed and target versions, and no others;
- version/tag diff: when installed and target versions differ and comparable history exists;
- `FRAMEWORK.md`, `WORKSPACE.md`, `TASKS.md`, `SKILLS.md`, `ROLES/`, `SKILLS/`, `TEMPLATES/`, `COMMANDS.md`, `prompts/`, and tool READMEs: only when the version diff or migration guidance identifies them as relevant;
- workspace/project skill indexes, local skills, mirrored agent entrypoints, `.gitignore`, and project boundaries: only when affected guidance or templates could make them stale.

## Update Sequence

### 1. Inspect the baseline

Record the installed version, available target version, repository boundaries, dirty files, and whether version-to-version comparison is possible. If the Operator requested a newer remote revision, inspect local state and identify the normal safe git operation, but leave it in the plan.

Treat a missing `CURRENT_VERSION` as an unknown installed version. Preserve that uncertainty until successful execution; do not infer version-specific migrations.

**Complete when:** source, target, version certainty, repository ownership, and every pre-existing dirty or conflicted file are recorded.

### 2. Build the update inventory

When no newer target is available, compare the workspace only against guidance that can be established from the installed framework. Otherwise inspect the applicable migration files and version diff. Inventory every changed framework path, classify its workspace impact, and identify any required, optional, or irrelevant adaptation.

For each potentially affected workspace file, record its owner, local customization, applicable template or guidance, and proposed disposition: add, merge, leave unchanged, or escalate. Include local skills and indexes when framework skill guidance changed; include root and mirrored entrypoints when bootstrap guidance changed; include `.gitignore` and nested repository boundaries when the repository model changed.

**Complete when:** every changed framework path and every discovered workspace adaptation has one sourced disposition, with no unclassified item.

### 3. Screen every traversed version for breaking changes

Enumerate every framework version strictly above the installed version through the target version, then check each one against the `MIGRATIONS.md` index. Never screen only the target version: a jump from v0.18.0 to v0.21.0 screens v0.19.0, v0.20.0, and v0.21.0. An indexed version's migration file declares a breaking change when it contains a `## Breaking changes` section; read that section in full. A version absent from the index declares none.

Treat evidence as insufficient — not safe — when the installed version is unknown, when `MIGRATIONS.md` or an indexed migration file cannot be read, when the index lists a file that does not exist, or when the traversed range cannot be enumerated because comparable version history is unavailable. Report the gap as an unresolved breaking-change risk and take it to the same Operator decision rather than assuming the range is clean.

**Complete when:** every traversed version has one recorded outcome — declares breaking changes, declares none, or evidence is insufficient — with no version unaccounted for.

### 4. Present a plan and stop at the gate

Return:

- installed and target versions, including comparison limitations;
- the breaking-change screening result for every traversed version;
- framework change inventory and workspace adaptation inventory;
- exact proposed git operations, file edits, setup commands, and validation checks;
- conflicts, ambiguous merges, sensitive-data risks, optional features, and files intentionally left unchanged;
- the final `CURRENT_VERSION` change, conditional on successful validation.

If no update or adaptation is needed, report a no-update result and stop without requesting execution approval. If a conflict or non-obvious merge exists, present choices and request the specific decision needed. Otherwise request explicit Operator approval for the bounded plan.

If step 3 recorded any declared breaking change or any insufficient-evidence gap, additionally stop for a distinct breaking-change decision. General approval of the update plan never satisfies this gate; the Operator must decide on the breaking changes themselves. For each one, present:

- the version that declares it and what it changes or removes;
- the likely impact on this specific workspace, sourced from observed workspace state rather than assumed;
- the migration reference that explains the adoption work;
- the safe choices, at minimum: proceed with this update and adopt the migration work; stop at an earlier non-breaking version; or pause the update until the Operator prepares the workspace.

For an insufficient-evidence gap, present what could not be established and what would resolve it instead of a change description.

**Complete when:** the run has stopped with either a checkable no-update result, a conflict decision request, a breaking-change decision request, or an approval-ready plan. No execution action has occurred.

### 5. Execute only the approved plan

After explicit approval, recheck repository state and target identity. Pause and re-plan if either changed. Do not execute while any declared breaking change or evidence gap from step 3 lacks an explicit Operator decision, and apply only the version range that decision covers. Apply only approved git operations and workspace adaptations, preserving local instructions and adapter-specific files unless the plan explicitly includes them.

Surface optional prompts and tools without configuring them unless approved. Keep session data, databases, exports, logs, env files, `.tools-config/`, and legacy `.task-browser/` metadata outside the framework repository.

**Complete when:** each approved operation has an observed result and the post-change inventory accounts for every modified, added, deleted, conflicted, skipped, or escalated file.

### 6. Validate before marking installed

Run the approved focused checks for affected behavior. At minimum:

- inspect diffs and run `git diff --check` in each changed repository;
- verify repository and `.gitignore` boundaries when affected;
- verify workspace-owned `projects/[name]/library/` and `work/` remain preserved under the default model when ignore rules changed;
- verify affected local skills, indexes, prompts, and mirrored entrypoints against current framework guidance;
- run applicable automated checks named by changed components or migration guidance.

Resolve failures or return to the conflict/approval gate with a revised plan. Only after all required checks pass, set `framework/CURRENT_VERSION` to the exact validated `framework/VERSION`, then verify they match.

**Complete when:** validation evidence passes, `CURRENT_VERSION` matches the validated framework version, and no unresolved approved item remains.

### 7. Report exhaustive results

Report old and new versions; every framework operation; every workspace file added, merged, unchanged, skipped, or escalated; validation evidence; optional capabilities discovered; and remaining follow-up. Distinguish pre-existing dirty files from this update's files.

**Complete when:** the report reconciles the plan, post-change inventory, final diffs, and validation evidence without an unaccounted file or action.

## Branch Outcomes

- **No update:** evidence shows the installed framework and applicable workspace setup are aligned; no execution or `CURRENT_VERSION` write occurs.
- **Planned update:** a complete bounded plan awaits explicit Operator approval; no execution occurs.
- **Breaking change declared:** one or more traversed versions declare a breaking change, or their evidence is insufficient; the changes, workspace impact, migration references, and safe choices await a distinct Operator decision and no sync occurs.
- **Conflict:** the exact local conflict or ambiguous merge and safe choices await a decision; unaffected inspection may be reported, but execution pauses.
- **Approved sync:** the unchanged approved plan is applied, validated, version-marked, and exhaustively reported.

## Companion Routing

- Consult relevant tool READMEs only when an affected optional tool branch is reached.
