# Framework Cockpit

Framework Cockpit is a local-only shell for small framework browser tools.

```bash
cd tools/tool-orchestrator
node server.mjs
```

Default URL: <http://localhost:8789>

Environment:

- `TOOL_ORCHESTRATOR_PORT` or `PORT` — server port, default `8789`.
- `WORKSPACE_ROOT` — framework workspace root. Defaults to the current working directory.
- `TOOL_ORCHESTRATOR_WORKSPACES_CONFIG` — optional path to a local JSON workspace config for multi-workspace Cockpit mode. If unset, Cockpit auto-loads `$WORKSPACE_ROOT/.tools-config/tool-orchestrator/workspaces.json` when that file exists; otherwise it falls back to single-workspace `WORKSPACE_ROOT` behavior.
- Existing Task Browser, Session Browser, and Tokens / Cost Analyzer environment variables still apply because the Cockpit mounts those tools in-process. `TOKENS_COST_ANALYZER_LIMIT` is especially useful for bounded Cockpit refreshes.

Mounted tools:

- `/tools/tasks/` — Task Browser
- `/tools/sessions/` — Session Browser
- `/tools/tokens-cost-analyzer/` — Tokens / Cost Analyzer (opt-in per configured workspace)

## Cockpit Widget Dashboard

The Cockpit home surface is a local-first widget dashboard. It ships a default layout without writing workspace files. Its wide `Subscription limits` widget shows remaining weekly Codex quota plus Claude Code's 5-hour and weekly quota (see below). Its wide `Needs attention` widget leads with the selected-workspace Operator count and up to three linked Operator tasks, with the Agent-ready count as secondary context. A calm zero state means no actionable task currently names the Operator; Task Browser owns inclusion and ordering through its summary API.

The first dashboard customization writes selected-workspace config to:

```text
$WORKSPACE_ROOT/.tools-config/tool-orchestrator/dashboard.json
```

Config schema:

```json
{
  "version": 1,
  "workspaceId": "main",
  "layout": [
    { "id": "task-counts", "type": "task-counts", "size": "small" },
    { "id": "priority-tasks", "type": "priority-tasks", "size": "wide" },
    { "id": "latest-bookmarked-session", "type": "latest-bookmarked-session", "size": "small" },
    { "id": "latest-updated-session", "type": "latest-updated-session", "size": "small" },
    { "id": "subscription-limits", "type": "subscription-limits", "size": "wide" },
    { "id": "tools", "type": "tools", "size": "wide" }
  ]
}
```

## Subscription Limits Widget

The wide `subscription-limits` widget shows how much of each provider's quota
remains, so the Operator does not have to check `/usage` or a provider account
page. Providers are independent: one being unavailable never suppresses the
other or the rest of the dashboard.

- **Codex · Weekly** — read from the Codex CLI app-server method
  `account/rateLimits/read`. The call is retrieval-only: no thread and no turn
  are started, so no model runs. The weekly bucket is selected by
  `windowDurationMins == 10080` rather than by the `primary` position, which
  often carries the five-hour window.
- **Claude Code · Weekly** and **Claude Code · 5 hour** — read from
  `GET https://api.anthropic.com/api/oauth/usage` using Claude Code's own local
  OAuth token, taking the `seven_day` and `five_hour` windows. Both gauges come
  from a single request per refresh, so they share one read and fail together;
  each still reports its own window-specific reason when only one window is
  missing from an otherwise valid response.

The two weekly gauges share the first row, and Claude Code's five-hour gauge
sits below Claude Code's weekly one; narrow layouts stack all three.

Remaining percent is `100 − utilization`, clamped to `0–100` for display only.
Each gauge also shows the target remaining percent for an even usage pace:
`100 × time remaining ÷ window duration`. The difference between that target and
actual remaining quota is reported in percentage points over or under pace.
Gauge color compares the used share with the elapsed share of its reset window:
blue means usage is below 70% of elapsed-window pace and could be favored, green is on pace,
yellow is at least 15% ahead of pace, and red is at least 50% ahead. Blue waits
until 20% of the window has elapsed; yellow/red absolute safeguards apply at 85%
and 95% used. Missing or invalid timing falls back to the original static
remaining-percent thresholds. An absent or null window is unavailable, never
100% remaining.

Data comes from `GET /api/subscription-limits` (add `?refresh=1` to bypass the
nine-minute server cache) and returns per provider `status` (`ok` / `unavailable`),
`remainingPercent`, `resetsAt`, `windowLabel`, `windowDurationMins`, `source`,
`asOf`, and a coarse
`reason` when not `ok`. The widget refreshes every ten minutes, on window focus,
and on demand through its refresh button, preserving the last good values when a
refresh fails.

Security boundary — the token and the raw provider responses stay inside
`subscription-limits.mjs`:

- the Claude token is read at request time (`$CLAUDE_HOME/.credentials.json`,
  default `~/.claude`), kept in memory, and never logged, persisted, cached, or
  sent to the browser;
- failures are reduced to a coarse reason class, so no provider payload or
  credential detail reaches logs or the client;
- there is no mutation path and no OAuth refresh; a missing, expired, or
  rejected token, a changed endpoint, or an unexpected shape all fail soft to
  the provider's unavailable state.

Both providers are optional and are not capability-gated: availability is
per-run, so the widget renders with unavailable gauges when neither source
resolves.

## Authoring A Cockpit Widget

This is the canonical authoring guide for the current embedded widget architecture. Cockpit widgets are **glanceable recovery surfaces**: each answers one small question that helps the Operator resume work or choose a destination, then deep-links to the owning tool. If the proposed interaction needs a table, broad filtering, editing, or more than a glance and click-through, implement it in the owning tool instead.

### Widget contract

Before implementation, define:

- **Job:** the one recovery question the widget answers and the owning tool for the full workflow.
- **Identity:** a stable URL/config-safe `type` for behavior and a unique per-layout `id`. The current UI allows at most one instance of each type, but code must not assume `id` and `type` will always be identical.
- **Presentation:** a concise title and one catalog-owned supported size, currently `small` or `wide`. Choose for the content, not desired prominence. Catalog metadata overrides size hints in persisted layouts.
- **Capability:** the required owning tool, if any. Widgets unavailable in the selected workspace are omitted from both the default layout and Add Widget catalog.
- **Data:** a focused selected-workspace summary API owned by the domain tool. Cockpit owns catalog, layout/config, orchestration, rendering, and navigation; it must not read domain files or reproduce domain selection, ordering, or interpretation rules. Document response fields and empty/missing-data semantics with the owning API. When a widget genuinely has no owning tool — as with `subscription-limits`, whose sources are provider CLIs rather than a framework tool — the Cockpit server may own the summary API itself, but it must stay in its own module with the same contract: the API interprets the domain, and rendering stays free of provider I/O.
- **States:** useful loading, populated, empty, and error behavior. Empty is a calm valid result, not an error. Keep failures contained to the affected source where practical, preserve useful visible content during background refresh, escape untrusted text, and never inject domain-owned markup.
- **Destination:** a mounted owning-tool route that preserves the selected workspace and uses only supported stable query parameters. Omit or disable links with no meaningful target; viewing and editing remain in the owning tool.

Fetch a domain summary only when at least one visible widget needs it. Capability or source changes must fail soft rather than breaking unrelated dashboard content.

### Shared full-fidelity widget decisions

The `daily-usage` widget establishes a deliberate exception to reduced widget variants: when a shared component is already glanceable and its interaction is bounded, render it at full fidelity in both the owning tool and Cockpit rather than maintaining a compact fork. Host-visible variation should stay minimal; daily usage only hides the analyzer's year switcher and otherwise renders the same grid, summary, legend, and stats.

Use a generated artifact as the domain boundary when two hosts consume the same focused rollup. The analyzer writes `daily.json`; both its report API and Cockpit widget consume that artifact rather than recomputing daily interpretation in Cockpit or extracting it from a broader response.

When a widget independently forces expensive regeneration, coordinate client cadence with a server age guard. Daily usage polls every ten minutes while the analyzer rejects non-manual regeneration of artifacts younger than nine minutes. The one-minute offset avoids nearly-expired cache hits doubling worst-case staleness; manual refresh bypasses age but still joins single-flight work.

### Registration checklist

The registry and renderers intentionally remain embedded. A new widget normally touches these points:

1. Add server catalog metadata to `widgetCatalog` in `server.mjs`, including `type`, default `id`, size, and the owning `tool` capability when applicable.
2. Add it to the shipped default through the server catalog only when it should appear for every capable workspace. `availableWidgets()` controls capability-aware defaults and catalog visibility; `normalizeDashboardLayout()` controls accepted persisted entries.
3. Add matching title/size fallback metadata to the client `widgetCatalog` in `public/app.js`. Server catalog data remains authoritative after load.
4. Add client render dispatch and a focused renderer in `public/app.js`; update source-loading detection so its summary API is requested only while a dependent widget is visible.
5. If new domain data is required, extend the owning tool's summary API and tests. Keep inclusion, ordering, fallback, and stale-data rules there. Add only supported deep-link parameters to the owning tool.
6. Add focused styles, update this README's config example or catalog description when relevant, and verify Add Widget still prevents duplicate types.

Do not create a second authoring procedure elsewhere; link to this section instead.

### Validation checklist

For each widget, verify:

- the shipped default renders without creating local config, and a customized layout survives save/reload;
- Add Widget includes it only when hidden and its capability is enabled, and does not allow duplicate types;
- switching workspaces updates config, data, availability, and links without cross-workspace leakage;
- capability-enabled, capability-disabled, populated, empty, loading, source-error, and background-refresh paths remain useful, with prior content preserved on refresh failure where possible;
- every deep link opens the mounted owning tool with the intended selected workspace and supported selection/filter parameters;
- normal and edit modes work at normal and narrow widths, keyboard focus is visible, controls have meaningful labels, and untrusted text is safely escaped;
- owning summary API tests cover selection/order and missing or stale values, followed by focused API smoke checks, relevant `node --check` or tests, and `git diff --check`.

### Shared test ownership

`tools/shared-web/` has no package of its own, so a test file added there runs in no suite until an owning tool's `test` script names it explicitly. Cockpit owns `shared-web/refresh-coordinator.test.mjs`. When you add a shared test, assign it an owner in the same change.

### Architecture and skill decision

Keep widget registration and renderers embedded for now. The accepted dashboard has six widgets and simple dispatch; that does not justify a module system, formal shared registry, plugin API, or frontend build step.

Reconsider standalone widget modules plus one shared registry when a real change reveals at least one of these pressures:

- repeated defects caused by multi-file registration;
- materially different per-widget settings or lifecycle behavior;
- independent widget tests that are awkward with the embedded files;
- enough renderer growth to measurably impair navigation or review.

There is no `build-cockpit-widget` skill yet. This codebase-specific checklist is sufficient until at least two new widgets use it and reveal recurring procedural mistakes or a stable scaffoldable workflow. A future skill should orchestrate the canonical guide rather than duplicate it.

Optional multi-workspace config:

```json
{
  "defaultWorkspace": "main",
  "workspaces": [
    {
      "id": "main",
      "name": "Framework WS",
      "root": "/home/user/work/framework-ws",
      "taskMetadataPath": "/home/user/work/framework-ws/.tools-config/task-browser/tasks.json",
      "taskHistoryPath": "/home/user/work/framework-ws/.tools-config/task-browser/task-history.jsonl",
      "sessionMetadataPath": "/home/user/work/framework-ws/.tools-config/session-browser/metadata.json",
      "tools": { "task-browser": true, "session-browser": true, "tokens-cost-analyzer": true }
    },
    {
      "id": "client-a",
      "name": "Client A",
      "root": "/home/user/work/client-a",
      "tools": { "task-browser": true, "session-browser": false }
    }
  ]
}
```

Workspace IDs are URL-safe and selected with `?workspace=<id>`, so two browser tabs can keep different workspace contexts. Cockpit navigation shows only tools enabled for the selected workspace, and each tool's workspace switcher shows only workspaces where that tool is enabled. If only one eligible workspace remains, the switcher renders a label rather than a dropdown. Home links always use the Cockpit icon. Availability checks determine whether an enabled tool is ready or warning. Missing metadata/history paths use each tool's existing default for that workspace. Task Browser and Session Browser default to enabled when their entries are omitted; Tokens / Cost Analyzer requires an explicit `"tokens-cost-analyzer": true` per workspace because analysis can scan full local session history.

The Cockpit is additive. Standalone tools remain available with their existing commands:

```bash
cd tools/task-browser && node server.mjs
cd tools/session-browser && node server.mjs
cd tools/tokens-cost-analyzer && node server.mjs
```

It does not add remote hosting, authentication, sync, daemon behavior, or shared metadata defaults.

## Known Accepted Behaviors

Each entry is a deliberate trade-off or an observed consequence that was reviewed and left in place. None is an open defect. Revisit an entry only when it causes real friction, and record the outcome here.

### `daily-usage` shows the current year only, including when it is empty

With `showYearSwitcher: false` the shared component locks to `new Date().getUTCFullYear()` and does not fall back to the most recent year with data, unlike the analyzer. On 1 January, or in a workspace whose usage stopped in a previous year, the widget renders an empty grid and "0 across 0 active UTC days" while looking populated. The widget's own empty state is unreachable in that case because it tests `daily.length` across all years, not the rendered year.

This is intended — current year only was the requested behavior — but it is the one case where the widget can look broken while being correct. If it confuses someone in practice, the smallest fix is a rendered-year-aware empty message, not a fallback year, which would silently contradict the current-year decision.

### The dashboard re-renders wholesale every 60 seconds

`renderDashboard()` rebuilds `dashboardEl.innerHTML` for the entire layout on every dashboard poll. For most widgets this is invisible. For `daily-usage` it destroys and recreates the heatmap each minute, resetting its horizontal scroll position and re-running `revealToday`, so a user who scrolled to inspect an earlier part of the year loses that position within a minute.

Accepted because the render is cheap and the widget model is deliberately simple. If more widgets acquire internal view state — scroll, selection, expansion — this is the point where per-widget morphing or preserved state becomes worth the complexity, rather than patching one widget at a time.

### `URLSearchParams.prototype.size` is used in client code

`fetchDailyUsage` in `public/app.js` tests `params.size`, which requires Chrome 113+ / Safari 17+. That is fine for a local developer tool on current browsers, but the analyzer uses `params.toString()` for the same check. Prefer `toString()` in new code so the two read alike.

### Saved layouts are validated against the catalog, not against capability

`normalizeDashboardLayout` filters a persisted layout by whether the widget `type` exists in the catalog, not by whether the owning tool is currently available. A workspace whose saved layout contains a widget for a tool that later becomes unavailable keeps that widget and shows its error or empty state rather than dropping it. This applies to every capability-gated widget.

Leaving it is deliberate: silently deleting a user's widget when a tool is temporarily unmounted would be worse than showing a soft failure. Worth revisiting only if the failed state proves confusing rather than merely untidy.

The full-fidelity `daily-usage` exception to the reduced-widget guideline is a fifth accepted trade-off; it is documented above under "Shared full-fidelity widget decisions".
