---
name: docs-sync
description: "Repair a bounded documentation contradiction or synchronize docs to a completed implementation change; audit all project docs only when explicitly requested."
---

# Skill: Docs Sync

## Purpose

Repair a bounded documentation contradiction against authoritative evidence while leaving unrelated documentation untouched.

## Scope Gate

Admit exactly one branch before inspection:

1. **Targeted contradiction (default):** use when the contradiction, supporting evidence, and documentation target are identified.
2. **Implementation synchronization:** use after a completed task or change; bound inspection to its diff, verified behavioral surface, and docs that claim to describe that surface.
3. **Full documentation audit:** use only when the Operator explicitly requests a full audit and names the project.

If the project, changed behavior, contradiction, or documentation surface needed by the selected branch is absent or ambiguous, ask the Operator to choose or supply it before broad inspection. The branch is admitted when its boundary can be stated in one sentence and its evidence and candidate documentation surfaces are named.

Invoke this workflow directly when the contradiction, authority, project, and candidate documentation surface are already identified. Use `project-self-check` upstream only when project maintenance discovers or still needs to scope the drift; it hands admitted contradictions to this repair workflow. `self-check` owns workspace coordination, `task-closure` owns task dispositions, and `FRAMEWORK.md`/`TASKS.md` own universal procedure.

## Required Inputs

- the admitted branch and its boundary;
- the contradiction or completed behavioral change;
- candidate documentation locations;
- authoritative implementation, behavior, decision, or specification evidence.

Load task context only when it supplies evidence or bounds the completed change. Load project library guidance only when a claim belongs in durable project knowledge.

## Workflow

### 1. Establish authority

For each admitted claim, identify the source authoritative for that claim: executable behavior and tests for current behavior, accepted decisions/specifications for intended contracts, or an explicitly designated canonical document for documentation-only facts. Record the evidence precisely enough to recheck it.

When relevant authorities disagree and their precedence does not resolve the claim, stop and ask the Operator which authority governs. This gate passes when every admitted claim has one unambiguous authority or the run is blocked on a recorded authority conflict.

### 2. Build the contradiction ledger

Create a working ledger with one row per contradiction:

| Location | Current claim | Authoritative evidence | Disposition |
| --- | --- | --- | --- |

Use exactly one disposition per row:

- **correct** — replace the inaccurate claim;
- **remove obsolete** — delete a claim whose subject no longer exists;
- **consolidate into one authoritative source** — choose and update the canonical documentation location;
- **replace duplicate procedure with a reference** — point to the procedure owner instead of restating it;
- **defer with owner/reason** — name who decides or repairs it and why this run cannot.

Expand the ledger only along references or authoritative docs directly affected by an admitted claim. This step is complete when every in-bound contradiction is recorded and every row has evidence and a disposition.

### 3. Repair the minimal coherent surface

Apply each non-deferred disposition to all affected authoritative docs and necessary references. Update a generator or source template instead of generated output; when the source is unknown, stop and request clarification rather than patching the artifact. Keep unrelated docs unchanged.

If a repaired claim is durable project knowledge not already represented in its authoritative project location, update that location or add a ledger deferral with owner/reason. Otherwise skip the durable-knowledge gate.

For public/shareable files, inspect the proposed text and diff for private workspace state, internal coordination, secrets, credentials, personal data, and non-public project details; remove or generalize unsafe material before proceeding. Skip this gate for non-public changes.

This step is complete when every non-deferred row is implemented across its minimal coherent surface, generated-source ownership is respected, and conditional knowledge/public-safety gates are resolved.

### 4. Validate and account

Validate, where applicable:

- commands and examples against current behavior;
- referenced paths and links;
- focused searches for stale competing wording;
- generated output alignment with its changed source;
- every ledger row against its evidence and disposition;
- `git diff --check` on the bounded change.

For a public framework or project change, follow that project's version policy and record an explicit bump or no-bump decision; otherwise record that the version gate does not apply. The repair is ready for handoff only when all applicable checks pass, every ledger row is accounted for, deferred rows name an owner/reason, and the diff contains only the admitted minimal coherent surface.

## Outputs

- repaired authoritative documentation and necessary references;
- a fully accounted contradiction ledger;
- validation evidence and any conditional version decision;
- explicit deferred items with owner and reason.

## Stop Conditions

- the bounded repair and all applicable gates pass; or
- an authority, scope, generated-source, or safety ambiguity is recorded for Operator clarification.
