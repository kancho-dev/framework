# Tokens / Cost Analyzer

Read-only local alpha tool for normalizing Pi, OpenCode, Codex, and Claude Code session token/cost data and showing it as a visual local web report.

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

The browser automatically refreshes the report every 10 minutes; manual and automatic refreshes rebuild full-history analysis by default. To make server/Cockpit refreshes bounded, launch the tool or Cockpit with `TOKENS_COST_ANALYZER_LIMIT=N`; use `TOKENS_COST_ANALYZER_LIMIT=all` to be explicit about full-history refresh. Limited reports show a trust flag and generated metadata so they are not mistaken for full-history totals.

By default it writes private generated output to:

```text
.tools-config/tokens-cost-analyzer/report.v1.json
.tools-config/tokens-cost-analyzer/daily.json
.tools-config/tokens-cost-analyzer/scan-scope.json
```

`report.v1.json` is the analysis artifact: a header, an `origin` block, and one record per normalized message. `scan-scope.json` records which local roots that scan attributed against; it stays local and is never shared, because it contains absolute paths that `report.v1.json` deliberately omits. Session deep links resolve through it, so **after changing your workspace layout, re-run the analysis** — until you do, the dashboard says session links are unavailable rather than quietly dropping them.

## Workspaces: partitioning one machine's usage

The analyzer performs **one scan per machine** and attributes every record to exactly one workspace, so totals can never double-count. Without configuration, the scan is rooted at the workspace you launched it in and everything lands in a single catch-all workspace named after that directory.

To break one machine's usage down by project, declare partitions in `.tools-config/tokens-cost-analyzer/sources.json`:

```json
{
  "schemaVersion": 1,
  "self": {
    "machineId": "workstation",
    "root": "~",
    "catchAllId": "home",
    "workspaces": [
      { "id": "framework", "root": "~/projects/agent-framework" },
      { "id": "client-x",  "root": "~/work/client-x" }
    ]
  }
}
```

Each record is attributed to the **most specific** matching root; anything under `self.root` that matches no declared workspace falls to the catch-all. Adding workspaces therefore *partitions* your existing totals rather than narrowing them — the overall number is unchanged, and the By Workspace panel gains rows that sum exactly to it. Every workspace root must sit inside `self.root`, and every id must be unique.

Pointing `self.root` at your home directory is the way to capture all of a machine's usage in one place.

### Session deep links

A row in Top drivers or the trust inspector links to Session Browser only when the session is genuinely reachable from this Cockpit: the record is from **this machine**, its workspace resolves to a local root, and a Cockpit workspace is registered at that root with Session Browser enabled. Anything else renders as inert, workspace-labelled text — a dead link is worse than a plain label.

This means a catch-all rooted at `~` links only if you have registered a Cockpit workspace at `~`. If you scan your whole home directory and want links from that usage, register one (or declare finer `self.workspaces` matching the workspaces you already have). Sessions from other machines never link, by design.

## Aggregating other machines

Configure remote machines as sources in the same `sources.json`. **With no `sources.json`, nothing here applies and the analyzer behaves exactly as it always has — no network, no merge, no extra UI.**

```json
{
  "schemaVersion": 1,
  "staleReportAfterHours": 24,
  "staleFetchAfterHours": 24,
  "maxReportBytes": 67108864,
  "sources": [
    { "id": "laptop", "type": "ssh", "host": "laptop-main", "remotePath": "~/.tools-config/tokens-cost-analyzer/report.v1.json", "timeoutSeconds": 10 },
    { "id": "archive", "type": "file", "path": "/mnt/backup/report.v1.json", "enabled": false, "includeWhenStale": false }
  ]
}
```

Each remote machine simply runs the analyzer on its own schedule; there is no export step, and nothing is ever pushed. This machine **pulls** the report each remote already wrote.

### Outbound network access — a real posture change

This tool is otherwise a read-only local one. With `type: "ssh"` sources configured, **it makes outbound SSH connections to the hosts you name**. It stays read-only with respect to the remote — one bounded `cat <remotePath>`, never the remote analyzer, never a write, never anything derived from report contents — and it does nothing at all when no sources are configured. But the change is real and you should configure sources deliberately.

**SSH is a prerequisite and is delegated entirely to your own setup.** `sources.json` holds a host alias and a path, never credentials. Keys, users, ports, jump hosts, and host-key policy come from your `ssh_config` and agent. Connections use `BatchMode=yes`, so the analyzer can never sit on a passphrase prompt, and host verification is your normal `known_hosts` checking — an unknown host key is a legitimate failure you resolve once, outside this tool.

To reduce what the key can do to exactly one thing, restrict it on the remote:

```text
# remote ~/.ssh/authorized_keys
command="cat ~/.tools-config/tokens-cost-analyzer/report.v1.json",no-port-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA...
```

### Freshness, staleness, and failure

Two ages are tracked separately, because they mean different things: `staleReportAfterHours` (default 24) is how old the remote's *analysis* is, and `staleFetchAfterHours` (default 24) is how long since we last *reached* it. "That machine has not been used since Tuesday" and "we have not been able to check that machine since Tuesday" are not the same situation and are never collapsed into one word.

A stale source is still **counted** — its past usage is real. Each successfully validated report is cached locally, so a machine that is asleep or unreachable degrades to *stale*, not to *gone*, and totals do not oscillate as machines come and go. External attempts are reused for nine minutes (including failed attempts), concurrent requests share one attempt per source, and a manual refresh bypasses that age guard. Set `includeWhenStale: false` on a source to exclude it once its report goes stale.

The Sources card colours each row by *trust in the totals*, not by liveness:

| Colour | Meaning |
| --- | --- |
| 🟢 green | fresh and fully counted |
| 🟡 amber | **counted**, but not current — a stale report, a stale fetch, or a partial history. Normal for an idle machine. |
| 🔴 red | **a number is missing** — unreadable, invalid, an incompatible schema version, or costs excluded for a currency mismatch. The row says which and why. |
| ⚪ grey | switched off with `enabled: false`. Not a fault. |

No external-source condition can degrade local analysis: whatever happens to a source — unreachable, refused, missing, malformed, oversized, timing out — the dashboard still returns your complete local records.

### Privacy and what leaves this machine

A report contains ids, timestamps, model names, token counts, and costs. It never contains session content. Absolute paths are redacted: workspace roots, pricing paths, and home-directory prefixes in session references are stripped before the artifact is written, so `report.v1.json` cannot leak the producing machine's filesystem layout. Local path knowledge is reapplied on the reading side from local configuration. Error text shown in the UI is reduced to a state and a short sanitized detail; SSH stderr is never passed through, since it can echo hostnames, usernames, and key paths.

Both directions are worth stating plainly: a machine you add as a source can read nothing from you, and the report you expose to it reveals your usage and model mix, not your work.

### What the combined numbers mean

Aggregation combines **estimates**. The alpha framing above carries over unchanged: the total across machines is no more authoritative than the parts it is made of. Currencies are never converted — if a source reported in another currency, its tokens count and its costs do not, and the card says so. Where a total leaves something out, the Sources card names what and why rather than showing a bare number.

Optional private subscription records can live at:

```text
.tools-config/tokens-cost-analyzer/subscriptions.json
```

using records shaped like `id`, `month`, `service`, `amount`, and `currency`. The web UI uses them for a monthly subscription-vs-token-spend chart and effective subscription cost per 1M tokens.

The monthly chart labels token totals above each stack and compact subscription/estimated currency values inside their segments; tooltips retain the complete monthly details. The dashboard also derives UTC daily buckets from normalized records. It presents a Monday-first, multi-year token-usage heatmap; average usage per observed calendar day and active day; the latest 30 calendar days compared with the prior 30; and dynamic token share by source tool. Missing calendar dates render as zero usage. Source token totals are comparable for this overview, but source record counts are not because adapters can record at different granularities.

The analyzer includes a bundled Pi-derived pricing table at `data/pi-pricing.json`, so estimates work even when Pi is not installed locally. Copy `pricing.sample.json` to `.tools-config/tokens-cost-analyzer/pricing.json` only when you need workspace-local overrides or additional models; local entries are checked before the bundled table. Missing pricing or missing token fields are reported as unknown/unpriced, not zero. Use explicit `0` prices only for models you know were free for your local usage window.

Subscription comparisons are warning-only when currencies differ from token estimate currency. Token estimates are USD pricing-table estimates; manually normalize subscription records to USD before treating token and subscription totals as directly comparable.

The analyzer intentionally avoids context-window percentages and invoice-grade cost claims. Recorded native costs, source-derived token totals, pricing-table estimates, and unknowns are separate fields in `report.v1.json` and visible in the UI. Cockpit integration should be opt-in for selected workspaces; do not promote the analyzer as a default enabled tool until the workflow has broader validation.

OpenCode support reads assistant-message usage from the local `opencode.db`, and falls back to the `session` aggregate row only when no message-level usage exists. Its explicit per-response `tokens.total` is authoritative because it also covers `tokens.reasoning`, which is recorded beside `output` rather than inside it; when that total is missing, the analyzer derives it from `input + output + reasoning + cache.read + cache.write`. Reasoning tokens therefore count toward token totals but are not priced, so cost stays an input/output/cache estimate. Session Browser applies the same total and fallback rule (shared in `tools/shared-web/opencode-usage.mjs`), so both tools report the same OpenCode total.

Codex support reads local rollout JSONL files from `CODEX_SESSION_ROOT` or `$CODEX_HOME/sessions`. It uses `event_msg.token_count.info.last_token_usage` records and splits `cached_input_tokens` out of `input_tokens` so cached tokens are not double-counted. `total_token_usage` is cumulative and is not used for per-record accounting.

Observed local Codex rollout records do not expose cache-write tokens or native recorded cost. The analyzer estimates Codex cost from input, output, and cache-read tokens only, without repeating cache-write warnings on every Codex record.

Claude Code support reads local session JSONL files from `CLAUDE_PROJECTS_ROOT` (default `$CLAUDE_HOME/projects`, i.e. `~/.claude/projects`) and filters them to the workspace using each assistant message's recorded `cwd`. It maps Anthropic per-message `usage` directly — `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — with no de-duplication, because Anthropic's `input_tokens` already excludes cached reads. Sub-agent (sidechain) messages under `<parentSessionId>/subagents/agent-*.jsonl` are counted under the same `claude-code` source, and each record's `sessionBrowserPath` matches the Session Browser ref (`claude-code:<sessionId>` or `claude-code:<parentId>/agent-<agentId>`). Claude Code JSONL does not record native cost, so cost is a pricing-table estimate; models absent from the bundled estimated pricing table show as unpriced with a clear warning.
