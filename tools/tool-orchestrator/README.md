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
- Existing Task Browser and Session Browser environment variables still apply because the Cockpit mounts those tools in-process.

Mounted tools:

- `/tools/tasks/` — Task Browser
- `/tools/sessions/` — Session Browser

The Cockpit is additive. Standalone tools remain available with their existing commands:

```bash
cd tools/task-browser && node server.mjs
cd tools/session-browser && node server.mjs
```

It does not add remote hosting, authentication, sync, daemon behavior, or shared metadata defaults.
