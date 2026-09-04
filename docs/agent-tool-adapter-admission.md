# Agent Tool Adapter Admission

Use this contract when adding a native agent source to Session Browser, Tokens / Cost Analyzer, or both.

The goal is a **safe, truthful, useful adapter**, not ideal-state certification. Assess Sessions and Analyzer independently; a source does not need feature parity.

## Outcomes

Return one outcome for each requested tool:

- **Admit** — baseline requirements are met with no material unresolved risk.
- **Provisional admit** — the baseline is met, but bounded compatibility, drift, performance, or edge-case hardening remains. Record limits and reconsideration triggers.
- **Bounce** — a concrete defect risks privacy, workspace isolation, native data, stable identity, accounting correctness, failure isolation, regressions, or minimum usefulness.
- **Unsupported / defer** — the source lacks the native capability or sufficient evidence for a coherent implementation. Name what evidence would reopen the decision.

Do not Bounce merely because exhaustive ideal-state evidence is absent. Do not use an existing adapter as precedent for copying a known material defect.

## Evidence

Classify important claims:

- **Observed** — shown by a named source version, public documentation, synthetic fixture, or safely inspected local schema.
- **Derived** — deterministically computed from observed fields, documented and tested.
- **Assumed** — unverified; cannot satisfy baseline safety or correctness.
- **Unavailable** — absent from the source or not yet established.

Use synthetic/public-safe fixtures. Never commit real transcripts, credentials, identifying paths, or private usage reports.

## Common baseline

Every adapter must establish:

1. **Identity and compatibility**
   - Stable lowercase source id, distinct from provider and model.
   - Observed schema fixtures and explicit supported scope.
   - Validate structural fields required for safe normalization.
   - If reliable native version metadata exists, define a supported range or detection rule. Otherwise document structural detection.
   - Reject incompatible records fail-soft; never parse unknown shapes optimistically.

2. **References and workspace ownership**
   - Stable source-native session/event identity, or a tested deterministic fallback.
   - Explicit handling for branches, sidechains, retries, compaction, and moved workspaces where applicable.
   - Containment-aware workspace matching—not string prefixes.
   - Filter before expensive or privacy-sensitive detail reads where the source permits it.
   - Unknown ownership is excluded or labelled unknown, never guessed.

3. **Read-only privacy boundary**
   - Never mutate native stores, indexes, journals, authentication, or metadata.
   - Keep transcript content and credentials local.
   - Sanitize diagnostics and paths.

4. **Failure and resource isolation**
   - Missing, malformed, locked, oversized, unsupported, or unavailable sources cannot disable another source.
   - Define whether malformed units are skipped or the source snapshot is rejected.
   - Aggregate work must have either:
     - a deadline, preferably with cancellation; or
     - one finite local file/row snapshot, no unbounded child-process/network wait, per-source timing, and successful representative scans.
   - Child-process and network operations always require a deadline.
   - Full-history measurements, formal thresholds, pagination, and stronger caps may remain provisional hardening when the baseline is bounded.

5. **Capabilities and tests**
   - Declare each capability `supported`, `unsupported`, or `not-applicable`.
   - Never substitute zero, empty content, guessed metadata, or fabricated reopen commands for unavailable values.
   - Test representative success, malformed/partial data, workspace isolation, stable refs, unsupported capabilities, source failure, and existing-adapter regressions.

## Sessions gate

When requesting Session Browser admission:

- Normalize to the `SessionSummary` and `SessionDetail` contracts documented in the Session Browser README.
- Preserve unknown timestamps, titles, cwd, models, and usage rather than inventing defaults.
- Define message counters and canonical chronology, including tie-breakers.
- Keep list/detail summaries consistent for the same snapshot.
- Degrade source-specific records safely into bounded generic entries.
- Keep parent/child identity distinct from resumability.
- Offer reopen only when observed evidence proves a stable, safely quoted command.
- Verify list/detail fixtures, ordering, counters, workspace containment, refs, malformed content, source isolation, and reopen behavior when applicable.

## Analyzer gate

When requesting Tokens / Cost Analyzer admission:

- Identify each usage-bearing event and whether fields are per-event, request-total, or cumulative.
- Never sum cumulative snapshots as deltas.
- Define deterministic precedence and deduplication for retries or duplicate representations.
- Map only evidenced fields to input, output, cache read, and cache write.
- Split cached input when native input is inclusive.
- Preserve unknown token fields; do not turn them into zero to enable pricing.
- Keep provider/model provenance, native recorded cost, and pricing-table estimates separate.
- Missing prices or incomplete fields produce unpriced/partial records—not `$0`.
- Ensure stable record identity, exactly-once workspace attribution, repeat-scan idempotence, and derivation/cache invalidation.
- Test delta/cumulative behavior, duplicates, token mappings, model/provider changes, workspace isolation, repeated scans, malformed data, and pricing confidence.

## Cross-tool and adoption gate

For dual-tool adapters or deep links:

- Share one source id and canonical session identity.
- Keep correlation optional; neither tool may depend on the other.
- Qualify links by machine/workspace and expose them only when reachable.

Before publication:

- Document roots, overrides, dependencies, capabilities, limitations, and supported scope.
- Keep defaults conservative and fail-soft; enabling a new source by default requires explicit product approval.
- Preserve existing configuration or provide a migration.
- Decide framework, affected tool, report/schema, and derivation-semantics version impacts explicitly.
- Obtain independent review of safety, identity, accounting, fixtures, regressions, and public safety.

## Proposal template

```markdown
# <Source> Adapter Proposal

## Requested admission
- Sessions: yes/no
- Analyzer: yes/no

## Source and evidence
- Source id / native owner / provider:
- Observed schema or versions:
- Supported scope and detection:
- Evidence table: claim | Observed/Derived/Assumed/Unavailable | source

## Discovery, identity, and safety
- Roots and workspace filtering:
- Session/event identity and branches:
- Read bounds, deadlines, and timing evidence:
- Read-only proof and sanitized diagnostics:

## Capabilities
- Capability | Supported/Unsupported/N/A | evidence and UI behavior

## Sessions mapping
- Summary/detail, chronology, counters, degradation, reopen:

## Analyzer mapping
- Usage granularity, delta/cumulative rules, deduplication:
- Token mapping, provenance, unknowns, and cost confidence:

## Tests and adoption
- Fixtures, malformed/drift/workspace/performance/regressions:
- Configuration, docs, compatibility, and version decisions:

## Requested outcome
- Sessions: Admit / Provisional admit / Bounce / Unsupported-defer
- Analyzer: Admit / Provisional admit / Bounce / Unsupported-defer
- Admission-blocking risks:
- Provisional hardening and reconsideration triggers:
```

## Current-adapter calibration

The current adapters establish a practical evidence floor, not exemptions:

| Source | Sessions | Analyzer | Main hardening or defect |
|---|---|---|---|
| Pi | Admit | Provisional admit | Formal long-history thresholds and broader drift/workspace evidence. |
| OpenCode | Provisional admit | Bounce if newly proposed; existing integration is grandfathered | Analyzer `sqlite3` child process lacks a deadline. |
| Codex | Provisional admit | Provisional admit | Drift/workspace fixtures, fallback-event identity analysis, and formal performance thresholds. |
| Claude Code | Provisional admit | Provisional admit | Drift, duplicate/replay, workspace, and formal performance evidence. |

Grandfathering does not waive baseline requirements for new adapters. Concrete defects discovered by a proposal should become focused corrective work rather than silently expanding that adapter's scope.
