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

Each analysis run prints a `Timing:` line giving its total duration split into scan time per source and artifact emission, so a slowdown can be attributed to a source rather than guessed at as history grows. Derived records are cached in per-source shards and reused when the source is unchanged. Source file metadata (or OpenCode's `time_updated` watermark), pricing inputs, cost-estimator semantics, derivation semantics, the analyzer version, and workspace attribution configuration all participate in invalidation; a missing or corrupt shard is rebuilt automatically.

By default it writes private generated output to:

```text
.tools-config/tokens-cost-analyzer/report.v1.json
.tools-config/tokens-cost-analyzer/daily.json
.tools-config/tokens-cost-analyzer/scan-scope.json
.tools-config/tokens-cost-analyzer/derivation-cache/
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
  "maxReportBytes": 268435456,
  "refreshAfterMinutes": 10,
  "retryAfterMinutes": 10,
  "sources": [
    { "id": "laptop", "type": "ssh", "host": "laptop-main", "remotePath": "~/.tools-config/tokens-cost-analyzer/report.v1.json", "timeoutSeconds": 10 },
    { "id": "old-laptop", "type": "archived" },
    { "id": "backup", "type": "file", "path": "/mnt/backup/report.v1.json", "enabled": false, "includeWhenStale": false }
  ]
}
```

Each remote machine simply runs the analyzer on its own schedule; there is no export step, and nothing is ever pushed. This machine **pulls** the report each remote already wrote.

### Scheduling the analysis on the remote machine

**The analyzer never runs anything on a machine you add as a source.** It reads the report that machine already wrote — one fixed, bounded, read-only command — and nothing else. So a source's report is exactly as fresh as the schedule *on that machine* makes it; if a remote's report is a week old, it is because nothing regenerated it there.

Schedule it on the remote with whatever that machine already uses. A `cron` line:

```cron
# regenerate this machine's report every hour, on the hour
0 * * * * cd /home/you/workspace && /usr/bin/node tools/tokens-cost-analyzer/analyze.mjs --workspace /home/you/workspace >/dev/null 2>&1
```

Or a `systemd --user` timer, which survives reboots and catches up a missed run:

```ini
# ~/.config/systemd/user/tokens-cost-analyzer.service
[Unit]
Description=Regenerate the tokens/cost analyzer report

[Service]
Type=oneshot
WorkingDirectory=/home/you/workspace
ExecStart=/usr/bin/node tools/tokens-cost-analyzer/analyze.mjs --workspace /home/you/workspace
```

```ini
# ~/.config/systemd/user/tokens-cost-analyzer.timer
[Unit]
Description=Hourly tokens/cost analyzer report

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl --user enable --now tokens-cost-analyzer.timer
loginctl enable-linger "$USER"   # so the timer runs while you are not logged in
```

`maxReportBytes` (default 256 MB) bounds what a single source may hand this machine. Reports are large and grow with history — roughly 2.5 KB per record, so a machine with years of use measures around 100 MB. A source over the cap is **excluded**, never truncated, since a partial report would silently under-count; the row says the size observed and to raise this setting.

### Retired machines: `type: "archived"`

When a machine is decommissioned its history is still real, and it should keep counting. An archived source is a local, immutable report file — no transport, no SSH, nothing to reach:

```json
{ "id": "old-laptop", "type": "archived" }
```

It defaults to `.tools-config/tokens-cost-analyzer/archive/old-laptop.json`; set `path` to keep the file elsewhere. An archived source is **exempt from both staleness axes** — a report from 2024 is not stale, it is archival — and its row renders in a neutral archive tone rather than as a fault or a warning. It turns red only when the file is genuinely broken: missing, unreadable, or written by a newer schema version. `includeWhenStale` is rejected on an archived source, because it could only ever mean "drop this machine's history".

**Copy the report before you decommission the machine.** There is no way to regenerate it afterwards.

> **Back up `archive/`.** Every other file under `.tools-config/` is regenerable from your sessions; this one is not. It holds the only remaining copy of a retired machine's history, and the analyzer never writes, prunes, or cleans it.

### Outbound network access — a real posture change

This tool is otherwise a read-only local one. With `type: "ssh"` sources configured, **it makes outbound SSH connections to the hosts you name**. It stays read-only with respect to the remote — one bounded `gzip -c <remotePath>`, never the remote analyzer, never a write, never anything derived from report contents — and it does nothing at all when no sources are configured. Those connections happen on a **bounded cadence** (`refreshAfterMinutes`, default 10) rather than once per page load, so an open dashboard is not a continuous stream of SSH connections to every host you named. But the change is real and you should configure sources deliberately.

**SSH is a prerequisite and is delegated entirely to your own setup.** `sources.json` holds a host alias and a path, never credentials. Keys, users, ports, jump hosts, and host-key policy come from your `ssh_config` and agent. Connections use `BatchMode=yes`, so the analyzer can never sit on a passphrase prompt, and host verification is your normal `known_hosts` checking — an unknown host key is a legitimate failure you resolve once, outside this tool.

To reduce what the key can do to exactly one thing, restrict it on the remote:

```text
# remote ~/.ssh/authorized_keys
command="gzip -c ~/.tools-config/tokens-cost-analyzer/report.v1.json",no-port-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA...
```

**Reports are compressed on the wire.** An `ssh` source is fetched with `gzip -c` and decompressed here — measured ~19× smaller for a 100 MB report, which is what makes a distant machine practical. It is still one fixed, bounded, read-only remote command, and decompression is bounded by `maxReportBytes` so a small payload cannot expand without limit. If the remote has no `gzip`, or its key is still restricted to `cat`, the fetch falls back to plain `cat` automatically; set `"compress": false` on a source to skip the attempt entirely.

### Freshness, staleness, and failure

Two ages are tracked separately, because they mean different things: `staleReportAfterHours` (default 24) is how old the remote's *analysis* is, and `staleFetchAfterHours` (default 24) is how long since we last *reached* it. "That machine has not been used since Tuesday" and "we have not been able to check that machine since Tuesday" are not the same situation and are never collapsed into one word.

A stale source is still **counted** — its past usage is real. Each successfully validated report is cached locally, so a machine that is asleep or unreachable degrades to *stale*, not to *gone*, and totals do not oscillate as machines come and go. Set `includeWhenStale: false` on a source to exclude it once its report goes stale.

### How refreshing works

**Once a machine has given you a report, a dashboard request never waits on it again.** It serves the last report each source successfully gave you and, if that report is older than the refresh cadence, starts a fetch in the background. The page returns at local speed whether that source is fast, slow, asleep, or gone — and both ages above keep telling the truth about what you are looking at while it catches up. The one exception is the very first fetch of a newly configured source: with nothing yet to serve, that request is awaited (see the cadence settings below).

The **Refresh button** works the same way: it starts a refresh immediately, bypassing the cadence, and returns the page at once rather than making you wait for every machine. A source being fetched right now shows *Refreshing…* beside its state, and only that source's row changes. **Totals never update partially** — they hold their previous complete value and update in one step when the refresh lands, because a cost figure assembled from a subset of your machines is a wrong number briefly presented as a right one.

`refreshAfterMinutes` (default 10) is how often a source is re-fetched, and `retryAfterMinutes` (default 10) is how soon a source that just failed is tried again. **These are cadence, not freshness**, and they are deliberately not the two `stale…Hours` settings above: raising the cadence makes this machine talk to yours less often, and it never makes anything on screen claim to be newer than it is. The very first fetch of a newly configured source is awaited, so adding a machine gives you immediate feedback; every fetch after that is in the background. Concurrent requests and repeated Refresh clicks share one fetch per source rather than stacking them.

`GET /api/sources/status` serves the per-source rows on their own — state, both ages, record count, and whether a fetch is in flight. It is read-only and **triggers no fetch of its own**; the dashboard polls it while a refresh is running so a row's label can update without paying for a full merge.

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

The **Usage breakdown** panel answers where measured usage went, stacked and grouped by **agent tool, machine, machine-qualified workspace, or model**, with agent tool, model, machine, and machine-qualified workspace filters taken from the shared cohort controls in the dashboard header. The metric is **Tokens** (default) or **Estimated cost** — two separate choices, never stacked or summed together, because one is a local pricing-table estimate rather than a provider fact. **Recorded cost is not a stackable metric**: too few adapters carry native cost for the comparison to say anything, so it stays where it is a fact rather than a chart — per-segment tooltips, the all-time cards, and the monthly spend cockpit. Each metric option carries its own definition — and the currency for the cost metric — as help text on the option itself (tooltip and accessible name) rather than as permanent prose beside the control. Subscription spend never enters a record-level breakdown. In a cost view, records nothing could price are **counted as unpriced, never drawn or printed as `$0`**: a tool with no native recorded cost reads `unpriced · 1.7B tokens` in the legend, tooltips label missing amounts `unavailable` and always show both costs for comparison, and the footer states how many of the records in view carry no cost. The footer splits by permanence: standing explanations of what the panel measures and what a cost metric is fold away behind a `How to read these numbers` disclosure, while everything true only of the current cohort and window — unpriced counts, currency exclusions, excluded or stale sources, unattributed tokens, undated records — stays visible without opening anything. Records whose costs were excluded for a currency mismatch stay semantically distinct — their tokens are still counted, no converted amount is invented, and the exclusion is disclosed on its own line. The time bucket is Day, Week (default), or Month, and each grain carries one deterministic range stated beside the controls: the latest **30 UTC days**, **24 Monday–Sunday UTC weeks**, or **18 calendar months**. Buckets are never forced to a single bar count, and there is no range picker — the bucket is the range, and the exact visible window is always spelled out (`Sep 15, 2025 – Mar 1, 2026 UTC`). **History moves by whole windows**: `Previous` steps back exactly one full window and never skips an empty period, so an empty historical window is an answer rather than a dead end; `Next` and `Latest` return you toward the present, and nothing navigates past it. All three controls are always shown and **disabled** rather than hidden when unavailable, so they never shift position and the button under the pointer cannot change identity between clicks; a disabled control's tooltip says why (`No earlier usage in this cohort`, `Already at the latest window`). `Previous` is offered whenever the *currently selected cohort* has any dated usage before the visible window — filtering to a machine that only appears recently correctly removes it — and that availability is computed from the same aggregate cells the chart uses, never from records. Bucket, grouping, and the shared cohort survive navigation; changing the bucket returns to the latest window, because window N of weeks has no honest counterpart in months. Empty buckets keep their position so gaps stay visible, and a workspace id is never merged across machines. Each bar carries its own total above it, in the metric being drawn (compact money in a cost view, compact tokens otherwise) — the same idiom as the monthly spend chart; empty buckets carry no label, and the exact amount stays in the bar's tooltip. Bars therefore hold a width floor wide enough for that label and scroll sideways rather than shrinking below it, while dense axes thin their *date* labels from the newest bucket outward (halved again on narrow screens); every bar keeps its full range and composition in its tooltip. Records with missing attribution keep their own `Unknown …` series and filter option — never folded into `Other` — and undated records are disclosed as a count rather than placed on the axis. The filtered stack totals always sum exactly to the filtered token total, and the panel repeats the Sources coverage/freshness verdict in its footer, because a filtered view is exactly where a reader stops checking the global Sources card. Filtering the panel never filters Sources, which stays the global trust authority. Tool totals are descriptive: adapters record at different granularities and jobs differ, so the panel makes no efficiency or cost-per-job claim.

The sticky dashboard header carries the **analysis context**: `Agent tools · All`, `Models · All`, `Machines · All` / `Machines · 2 selected` multi-select triggers whose popovers list every value with its all-record token total, removable chips for the active selection, and Clear once anything is selected. The facets **intersect** and values inside one facet **union**, so `pi` plus machine `pc` means pi *on* pc. Narrow screens collapse all four triggers into a single `Filters · N selected` control. That one cohort scopes *Daily token usage* and *Usage breakdown*, including the heatmap's own averages and 30-day comparison, so those views never describe different subsets. Each scoped panel shows a non-interactive `Filtered · N` badge while narrowed; the header stays the only place a cohort is edited. Popovers close on outside click or Escape, and only one is ever open. Sources, the monthly spend cockpit, and subscriptions are never filtered. Subscriptions stays explicitly labelled as private local data beneath Daily token usage; the configurable breakdown and cohort controls replace the former fixed agent-tool, workspace, and model cards.

Model grouping uses **provider-qualified identity, but only as far as the adapters evidence it**. `pi` and `opencode` already emit qualified labels and the shared normalizer maps pi's `openai-codex` onto `openai`, so one model reached through two adapters is one series rather than two. `claude-code` states `anthropic` on every record, so its bare labels qualify cleanly. `codex` omits the provider on most records and names `openai` on the rest, so qualifying blindly would draw its busiest model as two series; instead a bare label adopts a qualified identity only when exactly one exists **in the same data**, and a label with two candidate providers stays unqualified rather than having one guessed for it. Models with no attribution keep their own `Unknown model` series and are never folded into `Other`. The **model filter carries that same identity** rather than the raw label, so one model is one checkbox and the filter selects exactly what the legend names.

The browser receives only per-day aggregates — one cell per UTC day, tool, machine, workspace, provider, and model — never the record set. Every filtered view is re-bucketed from those cells, so with no filter selected the daily series reproduces the report's own daily rollup exactly.

The analyzer includes a bundled Pi-derived pricing table at `data/pi-pricing.json`, so estimates work even when Pi is not installed locally. Copy `pricing.sample.json` to `.tools-config/tokens-cost-analyzer/pricing.json` only when you need workspace-local overrides or additional models; local entries are checked before the bundled table. Missing pricing or missing token fields are reported as unknown/unpriced, not zero. Use explicit `0` prices only for models you know were free for your local usage window.

Subscription comparisons are warning-only when currencies differ from token estimate currency. Token estimates are USD pricing-table estimates; manually normalize subscription records to USD before treating token and subscription totals as directly comparable.

The analyzer intentionally avoids context-window percentages and invoice-grade cost claims. Recorded native costs, source-derived token totals, pricing-table estimates, and unknowns are separate fields in `report.v1.json` and visible in the UI. Cockpit integration should be opt-in for selected workspaces; do not promote the analyzer as a default enabled tool until the workflow has broader validation.

New native sources must follow the shared [Agent Tool Adapter Admission contract](../../docs/agent-tool-adapter-admission.md), including its Analyzer accounting and provenance gate.

OpenCode support reads assistant-message usage from the local `opencode.db`, and falls back to the `session` aggregate row only when no message-level usage exists. Its explicit per-response `tokens.total` is authoritative because it also covers `tokens.reasoning`, which is recorded beside `output` rather than inside it; when that total is missing, the analyzer derives it from `input + output + reasoning + cache.read + cache.write`. Reasoning tokens therefore count toward token totals but are not priced, so cost stays an input/output/cache estimate. Session Browser applies the same total and fallback rule (shared in `tools/shared-web/opencode-usage.mjs`), so both tools report the same OpenCode total.

### Known limitation: sessions that change model mid-way

Tokens and cost are attributed per usage record, and each record is priced with the model that produced it — Pi tracks `model_change`/`thinking_level_change` state, OpenCode and Claude Code carry the model on each message. **Totals and the by-model breakdown are therefore correct even when a session switches models.**

What is not correct is the *label* on session-scoped views. A session rollup keeps the first record's model, and Session Browser shows the model in effect at the end of the session, in both cases with no indication that other models were used. Read a session row's model as "one of the models this session used", not "the model this session used", and use the by-model chart when the split matters. Mid-session model changes are uncommon enough that this is accepted behavior rather than a planned fix; the transcript in Session Browser still shows each `model_change` entry if you need the real sequence. Codex is the one source that discards the sequence at ingest — it keeps only the last `turn_context` model.

Tiered pricing follows Pi's request-wide semantics. The threshold compares `input + cacheRead + cacheWrite`, exact-boundary requests stay at the base rate, and a request above the threshold uses the selected tier's complete input, output, cache-read, and cache-write rate set. A dimension a source never reports — Codex does not record cache writes — counts as zero toward the threshold rather than blocking tier selection. Malformed tiers or genuinely unknown threshold token fields retain base pricing and emit an explicit partial-estimate warning.

Codex support reads local rollout JSONL files from `CODEX_SESSION_ROOT` or `$CODEX_HOME/sessions`. It uses `event_msg.token_count.info.last_token_usage` records and splits `cached_input_tokens` out of `input_tokens` so cached tokens are not double-counted. `total_token_usage` is cumulative and is not used for per-record accounting.

Observed local Codex rollout records do not expose cache-write tokens or native recorded cost. The analyzer estimates Codex cost from input, output, and cache-read tokens only, without repeating cache-write warnings on every Codex record.

Claude Code support reads local session JSONL files from `CLAUDE_PROJECTS_ROOT` (default `$CLAUDE_HOME/projects`, i.e. `~/.claude/projects`) and filters them to the workspace using each assistant message's recorded `cwd`. It maps Anthropic per-message `usage` directly — `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` — with no de-duplication, because Anthropic's `input_tokens` already excludes cached reads. Sub-agent (sidechain) messages under `<parentSessionId>/subagents/agent-*.jsonl` are counted under the same `claude-code` source, and each record's `sessionBrowserPath` matches the Session Browser ref (`claude-code:<sessionId>` or `claude-code:<parentId>/agent-<agentId>`). Claude Code JSONL does not record native cost, so cost is a pricing-table estimate; models absent from the bundled estimated pricing table show as unpriced with a clear warning.

## Versioning

The analyzer's version is **provenance**: it is stamped into the `report.v1.json` header and onto
every record's `derivation`, so a merged multi-machine report says which build produced each record.
It is not a compatibility contract — that is the independently versioned `report.v1.json` schema, and
reports from different analyzer versions merge freely.

Cache invalidation does not *rely* on the version number moving. `DERIVATION_SEMANTICS_VERSION`
(`derivation-semantics.mjs`) covers changes to how a session file becomes a record, and
`COST_ESTIMATOR_VERSION` covers cost arithmetic. Increment the relevant one whenever you change that
behavior — that is the lever to reach for, and it works whether or not the release version moves.

The analyzer version **also** participates in the derivation cache key, deliberately. It is a
backstop for the case the constants exist to handle: someone changes an adapter and forgets to
increment. Over-invalidating is the harmless direction; serving stale records is not.

The practical consequence is that **every version bump costs one full re-derivation**. Measured here
on 50,280 records across 788 shards: cold **6.8 s** against a warm **1.4 s**, after which runs are
warm again. Shards are rewritten in place — the shard path is a hash of the source file path — so
nothing accumulates on disk, and no configuration, artifact, or stored data is affected. That cost
scales with total history; if archived stores ever push cold derivation into tens of seconds, drop
the version from the cache key and let the semantic constants carry invalidation alone.
