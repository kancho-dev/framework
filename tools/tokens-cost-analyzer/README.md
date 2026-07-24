# Tokens / Cost Analyzer Prototype

Experimental read-only local prototype for normalizing Pi, OpenCode, Codex, and Claude Code session token/cost data and showing it as a visual local web report.

This tool is an alpha cost-visibility aid, not invoice-grade billing, provider reconciliation, or a recommended/default workflow for every framework workspace. Treat the output as local planning evidence with explicit uncertainty labels.

```bash
node tools/tokens-cost-analyzer/server.mjs
# open http://localhost:8790
```

CLI-only analysis is also available:

```bash
node tools/tokens-cost-analyzer/analyze.mjs --workspace "$PWD"
```

By default the analyzer reads all in-scope local sessions/files. For a faster recent-only CLI run, pass `--limit N` (or `--limit all` to be explicit about the default full-history behavior). `--limit N` limits recent sessions/files per source, not emitted records/messages.

Browser Refresh also rebuilds full-history analysis by default. To make server/Cockpit refreshes bounded, launch the tool or Cockpit with `TOKENS_COST_ANALYZER_LIMIT=N`; use `TOKENS_COST_ANALYZER_LIMIT=all` to be explicit about full-history refresh. Limited reports show a trust flag and generated metadata so they are not mistaken for full-history totals.

By default it writes private generated output to:

```text
.tools-config/tokens-cost-analyzer/normalized.json
.tools-config/tokens-cost-analyzer/report.md
```

Optional private subscription records can live at:

```text
.tools-config/tokens-cost-analyzer/subscriptions.json
```

using records shaped like `id`, `month`, `service`, `amount`, and `currency`. The web UI uses them for a monthly subscription-vs-token-spend chart and effective subscription cost per 1M tokens.

The monthly chart labels token totals above each stack and compact subscription/estimated currency values inside their segments; tooltips retain the complete monthly details. The dashboard also derives UTC daily buckets from normalized records. It presents a Monday-first, multi-year token-usage heatmap; average usage per observed calendar day and active day; the latest 30 calendar days compared with the prior 30; and dynamic token share by source tool. Missing calendar dates render as zero usage. Source token totals are comparable for this overview, but source record counts are not because adapters can record at different granularities.

The analyzer includes a bundled Pi-derived pricing table at `data/pi-pricing.json`, so estimates work even when Pi is not installed locally. Copy `pricing.sample.json` to `.tools-config/tokens-cost-analyzer/pricing.json` only when you need workspace-local overrides or additional models; local entries are checked before the bundled table. Missing pricing or missing token fields are reported as unknown/unpriced, not zero. Use explicit `0` prices only for models you know were free for your local usage window.

Subscription comparisons are warning-only when currencies differ from token estimate currency. Token estimates are USD pricing-table estimates; manually normalize subscription records to USD before treating token and subscription totals as directly comparable.

The prototype intentionally avoids context-window percentages and invoice-grade cost claims. Recorded native costs, source-derived token totals, pricing-table estimates, and unknowns are separate fields in `normalized.json` and visible in the UI. Cockpit integration should be opt-in for selected workspaces; do not promote the analyzer as a default enabled tool until the workflow has broader validation.

Codex support reads local rollout JSONL files from `CODEX_SESSION_ROOT` or `$CODEX_HOME/sessions`. It uses `event_msg.token_count.info.last_token_usage` records and splits `cached_input_tokens` out of `input_tokens` so cached tokens are not double-counted. `total_token_usage` is cumulative and is not used for per-record accounting.

Observed local Codex rollout records do not expose cache-write tokens or native recorded cost. The analyzer estimates Codex cost from input, output, and cache-read tokens only, without repeating cache-write warnings on every Codex record.

Claude Code support reads local session JSONL files from `CLAUDE_PROJECTS_ROOT` (default `$CLAUDE_HOME/projects`, i.e. `~/.claude/projects`) and filters them to the workspace using each assistant message's recorded `cwd`. It maps Anthropic per-message `usage` directly — `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — with no de-duplication, because Anthropic's `input_tokens` already excludes cached reads. Sub-agent (sidechain) messages under `<parentSessionId>/subagents/agent-*.jsonl` are counted under the same `claude-code` source, and each record's `sessionBrowserPath` matches the Session Browser ref (`claude-code:<sessionId>` or `claude-code:<parentId>/agent-<agentId>`). Claude Code JSONL does not record native cost, so cost is a pricing-table estimate; models absent from the bundled estimated pricing table show as unpriced with a clear warning.
