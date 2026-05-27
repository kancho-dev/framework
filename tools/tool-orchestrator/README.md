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
