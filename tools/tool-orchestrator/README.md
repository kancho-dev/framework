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
- Existing Task Browser and Session Browser environment variables still apply because the Cockpit mounts those tools in-process.

Mounted tools:

- `/tools/tasks/` — Task Browser
- `/tools/sessions/` — Session Browser

## Cockpit Widget Dashboard

The Cockpit home surface is a local-first widget dashboard. It ships a default layout without writing workspace files. The first dashboard customization writes selected-workspace config to:

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
    { "id": "tools", "type": "tools", "size": "wide" }
  ]
}
```

## Authoring A Cockpit Widget

This is the canonical authoring guide for the current embedded widget architecture. Cockpit widgets are **glanceable recovery surfaces**: each answers one small question that helps the Operator resume work or choose a destination, then deep-links to the owning tool. If the proposed interaction needs a table, broad filtering, editing, or more than a glance and click-through, implement it in the owning tool instead.

### Widget contract

Before implementation, define:

- **Job:** the one recovery question the widget answers and the owning tool for the full workflow.
- **Identity:** a stable URL/config-safe `type` for behavior and a unique per-layout `id`. The current UI allows at most one instance of each type, but code must not assume `id` and `type` will always be identical.
- **Presentation:** a concise title and one catalog-owned supported size, currently `small` or `wide`. Choose for the content, not desired prominence. Catalog metadata overrides size hints in persisted layouts.
- **Capability:** the required owning tool, if any. Widgets unavailable in the selected workspace are omitted from both the default layout and Add Widget catalog.
- **Data:** a focused selected-workspace summary API owned by the domain tool. Cockpit owns catalog, layout/config, orchestration, rendering, and navigation; it must not read domain files or reproduce domain selection, ordering, or interpretation rules. Document response fields and empty/missing-data semantics with the owning API.
- **States:** useful loading, populated, empty, and error behavior. Empty is a calm valid result, not an error. Keep failures contained to the affected source where practical, preserve useful visible content during background refresh, escape untrusted text, and never inject domain-owned markup.
- **Destination:** a mounted owning-tool route that preserves the selected workspace and uses only supported stable query parameters. Omit or disable links with no meaningful target; viewing and editing remain in the owning tool.

Fetch a domain summary only when at least one visible widget needs it. Capability or source changes must fail soft rather than breaking unrelated dashboard content.

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

### Architecture and skill decision

Keep widget registration and renderers embedded for now. The accepted dashboard has five widgets and simple dispatch; that does not justify a module system, formal shared registry, plugin API, or frontend build step.

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
      "tools": { "task-browser": true, "session-browser": true }
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

Workspace IDs are URL-safe and selected with `?workspace=<id>`, so two browser tabs can keep different workspace contexts. Missing `tools` entries default to enabled; availability checks still determine whether a tool is ready or warning. Missing metadata/history paths use each tool's existing default for that workspace.

The Cockpit is additive. Standalone tools remain available with their existing commands:

```bash
cd tools/task-browser && node server.mjs
cd tools/session-browser && node server.mjs
```

It does not add remote hosting, authentication, sync, daemon behavior, or shared metadata defaults.
