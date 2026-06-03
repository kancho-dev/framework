# Tokens / Cost Analyzer Prototype

Experimental read-only local prototype for normalizing Pi and OpenCode session token/cost data and showing it as a visual local web report.

This tool is an alpha cost-visibility aid, not invoice-grade billing, provider reconciliation, or a recommended/default workflow for every framework workspace. Treat the output as local planning evidence with explicit uncertainty labels.

```bash
node tools/tokens-cost-analyzer/server.mjs
# open http://localhost:8790
```

CLI-only analysis is also available:

```bash
node tools/tokens-cost-analyzer/analyze.mjs --workspace "$PWD"
```

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

The analyzer includes a bundled Pi-derived pricing table at `data/pi-pricing.json`, so estimates work even when Pi is not installed locally. Copy `pricing.sample.json` to `.tools-config/tokens-cost-analyzer/pricing.json` only when you need workspace-local overrides or additional models; local entries are checked before the bundled table. Missing pricing or missing token fields are reported as unknown/unpriced, not zero. Use explicit `0` prices only for models you know were free for your local usage window.

Subscription comparisons are warning-only when currencies differ from token estimate currency. Token estimates are USD pricing-table estimates; manually normalize subscription records to USD before treating token and subscription totals as directly comparable.

The prototype intentionally avoids context-window percentages and invoice-grade cost claims. Recorded native costs, source-derived token totals, pricing-table estimates, and unknowns are separate fields in `normalized.json` and visible in the UI. Cockpit integration should be opt-in for selected workspaces; do not promote the analyzer as a default enabled tool until the workflow has broader validation.
