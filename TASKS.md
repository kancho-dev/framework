# Task Reference

Use this reference when creating, picking up, reviewing, or closing framework-managed tasks.

## Choose The Lightest Track That Fits

### Micro task

Tiny one-run work that does not justify a task directory.

Use for:

- quick answers;
- small inspections;
- trivial edits with no follow-up;
- minor state updates.

Durable trace:

- no task directory required;
- append a timed entry to the end of today's daily brief when the work is meaningful;
- update `ACTIVE-CONTEXT.md` when priorities, blockers, or direction change.

Micro tasks are intentionally lightweight. If future task-browser tooling needs complete visibility for tiny work, add a lightweight index later rather than forcing every small action into a task directory now.

### Tracked task

Use a task directory when work needs durable task state, handoff, review evidence, or future visibility.

Use for:

- multi-session work;
- delegated work;
- risky or review-loop work;
- durable project work;
- work that should appear in task/project tooling.

Task directory structure:

```text
projects/[name]/work/[task-slug]/
  TASK.md
  HANDOFF.md
  CONTEXT.md
  runs/
```

Initialize task files from:

- `framework/TEMPLATES/TASKS/TASK.md`
- `framework/TEMPLATES/TASKS/HANDOFF.md`
- `framework/TEMPLATES/TASKS/CONTEXT.md`
- `framework/TEMPLATES/TASKS/RUN-LOG.md`

Keep `HANDOFF.md` and `CONTEXT.md` as short as possible, but not shorter than needed for safe continuation. Add detail only when it improves handoff, stable context, or review evidence.

## Task Files

### `TASK.md`

Static instructions for the task: purpose, scope, desired outcome, constraints, acceptance criteria, and success criteria.

### `HANDOFF.md`

Current operational state. Update before ending a task session.

Keep it focused on what the next run needs immediately:

- current state;
- next action;
- blockers or watch-outs.

### `CONTEXT.md`

Stable facts that should survive across sessions. Do not put temporary status here.

Keep it concise. Add durable facts, decisions, constraints, references, or background only when they matter beyond the current run.

### `runs/`

Append-only run logs for task sessions and meaningful reviews.

### Additional task-local working files

Tasks may contain extra working files such as analysis notes, design drafts, migration comparisons, or larger exploratory material. Use this for task-local work that is too substantial for transient notes and not ready for durable project `library/` files.

### Optional `NOTES.md` — Steering Notes

Task-local `NOTES.md` is the portable store for one transient **Steering Notes** payload for the next Task Run. It is distinct from durable task files, task-browser workflow metadata, and workspace **Operator Notes** in `OPERATOR-NOTES.md`.

At the start of every Task Run, check `NOTES.md` exactly once. Missing, empty, and whitespace-only files mean no payload. If it is non-empty:

1. read and capture the payload successfully;
2. immediately delete `NOTES.md`;
3. act on the captured payload once;
4. promote only lasting decisions or outcomes into authoritative task, project, or workspace files.

Do not poll during an active run. Steering Notes saved after the check remain pending for the following run; redirect an active session through that session or stop/restart outside this mechanism.

The Operator may author Steering Notes, and a coordinating Overseer may author them for a separate next Task Run. Builders and Oracles must use `HANDOFF.md` and run logs for routine implementation and review handoff. Steering Notes may clarify, narrow, or reprioritize work within the durable task contract, but cannot override security guidance, `TASK.md`, or established constraints. On conflict, capture and clear the payload, record the conflict durably, and request Operator clarification before conflicting work.

Every task run log records exactly one compact field: `Steering Notes: none` or `Steering Notes: consumed`. Do not copy transient contents verbatim by default; when relevant, summarize their effect and durable destination.

## Task Directory Naming

Use a short descriptive slug.

Preferred pattern:

```text
[project-id]-[task-slug]
```

Examples:

- `#13-build-pipeline`
- `api-auth-cleanup`
- `docs-release-prep`

Rules:

- lowercase;
- words separated by `-`;
- include a project/task ID when one exists.

## Task Patterns

### Direct task

One focused run on bounded work.

### Task pickup

Resume an existing task from task files.

### Review loop

A Builder run produces a bounded slice, then a separate Oracle task run reviews it. The Oracle returns `approve`, `bounce`, or `needs clarification`.

### Maintenance

A Historian or Overseer run cleans state, syncs docs, or reduces drift.

### Research / plan

An Overseer run gathers evidence, clarifies scope, and prepares the next implementation slice.

## Builder–Oracle Loop

Use this as the default quality pattern when implementation work should be reviewed before being treated as complete.

1. The Operator or Overseer defines or clarifies the task.
2. Builder completes one bounded slice.
3. Builder records what changed, what was checked, and what remains.
4. Oracle reviews in a separate task run against the task goal and acceptance criteria.
5. Oracle records a durable review result unless the review is explicitly read-only/no-write.
6. Oracle returns a verdict: `approve`, `bounce`, or `needs clarification`.
7. If bounced, the next Builder fixes the listed issues and resubmits.

Keep meaningful Oracle reviews separate from Builder implementation runs. This preserves a clear quality gate and makes review evidence easy to find in task history.

A good review result includes:

- verdict;
- what was checked;
- findings;
- required fixes when not approved;
- confidence level when uncertainty remains.

For meaningful reviews, write a separate Oracle task run log, update `HANDOFF.md`, and append a timed entry to the end of today's daily brief. If a delegated/no-write reviewer cannot write files, the coordinating session should import the result.

## Task-browser Metadata Hygiene

This section applies only in workspaces that use the optional task-browser tool, for example when `.tools-config/task-browser/tasks.json` exists, the Operator says the board is used, or the current task asks for task-browser metadata updates.

Task markdown remains the source of truth. Task-browser metadata and metadata history are local workflow/provenance data by default and must not be the only record of state, blockers, review results, or closure.

When task-browser is used, agents should keep metadata aligned before ending meaningful tracked-task work:

- creation: initialize `status`, `priority`, `type`, useful `tags`, known relationships, and `nextActor` from the concrete next action;
- pickup: set `status: active` when the task becomes the current target, then compare `nextActor` with `HANDOFF.md`'s `Next Action`;
- review handoff: set `status: review`; set it back to `active` on bounce;
- pause/block: use `paused` for deferral, `blocked` for concrete blockers, and put generic blocker details in task markdown;
- relationships: store `parent`, `children`, `related`, and `blockedBy` as canonical task keys; `blockedBy` should point only at existing task blockers;
- closure: set `status: done` only after task files record acceptance or closure.

`nextActor` records who must take the next meaningful action for the task to advance. It is nullable workflow metadata, not task status, ownership, assignment, or a substitute for the narrative `HANDOFF.md` next action. Use this authoritative decision matrix:

| Situation | `nextActor` |
| --- | --- |
| Task is ready for Agent implementation, research, or planning, or Agent work continues | `agent` |
| Task awaits an Operator decision, input, approval, review, or manual action | `operator` |
| Task is handed to an Oracle for review | `agent` |
| Task is handed to the Operator for review or acceptance | `operator` |
| Oracle bounces work back to a Builder | `agent` |
| A concrete blocker can be resolved by the Operator or an Agent | whichever actor must resolve it |
| Work is paused, done, externally blocked, parked without a concrete action, or has no actionable Operator/Agent step | `null` |

At creation, use `agent` when the task is ready for Agent work, `operator` when explicit Operator action is required, and `null` otherwise. On pickup and whenever `HANDOFF.md`'s narrative next action changes the responsible actor, align `nextActor`. Before ending meaningful tracked-task work, compare the two again and set or clear the field. Do not infer or change `nextActor` merely because `status` changed; lifecycle and action responsibility are orthogonal.

Use `tools/task-browser/metadata-cli.mjs` as the preferred non-interactive way to inspect or update metadata. It accepts display IDs such as `#32` and canonical keys such as `agent-framework/task-slug`, but stores relationships as canonical keys. In framework versions with task-browser action history, CLI writes append local `.tools-config/task-browser/task-history.jsonl` events by default for actual durable metadata changes. Agents may pass real provenance when useful, such as `--role Builder`, `--session-tool pi`, or `--session-id ...`; leave role/session details unset rather than inventing them. See `tools/task-browser/README.md` for detailed history behavior and privacy notes.

## End Of Task Session

Before ending meaningful task work:

1. update the relevant handoff or context files;
2. write a run log when there is a task directory;
3. append a timed entry to the end of today's daily brief with the real current time;
4. if task-browser is used and task state changed, align task-browser metadata;
5. move durable knowledge to project `library/` or `FIXES.md` when relevant.
