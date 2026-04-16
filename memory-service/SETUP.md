# Memory Service Setup

This guide covers the first local setup flow for the framework memory-service.

## What `MEMORY_WORKSPACE` Is For

`MEMORY_WORKSPACE` is a logical workspace label stored with imported records.

It is currently used to:
- stamp imported `sessions`, `messages`, and `work_reports` with a workspace name
- stamp manually added `lessons` with a workspace name
- keep the schema ready for cases where one PostgreSQL database stores memory for more than one workspace

Example uses:
- `framework-workspace`
- `personal-workspace`
- `client-a-workspace`

If you only use one workspace, set it to a stable descriptive name and leave it alone.

Example:

```env
MEMORY_WORKSPACE=framework-workspace
```

## 1. Go To The Memory-Service Directory

```bash
cd /path/to/your/framework-workspace/framework/memory-service
```

## 2. Install Dependencies

```bash
npm install
```

This creates:
- `node_modules/`
- `package-lock.json` if it is not already present

## 3. Create The Local Env File

```bash
cp .env.example .env
```

Example `.env`:

```env
MEMORY_DB_HOST=localhost
MEMORY_DB_PORT=5432
MEMORY_DB_NAME=agent_framework
MEMORY_DB_USER=agent_framework
MEMORY_DB_PASSWORD=change-me
MEMORY_DB_SCHEMA=memory
MEMORY_WORKSPACE=framework-workspace
MEMORY_WORKSPACE_ROOT=/path/to/your/framework-workspace
MEMORY_OPENCODE_DB_PATH=~/.local/share/opencode/opencode.db
MEMORY_SQLITE3_BIN=sqlite3
```

## 4. PostgreSQL Setup Options

### Option A: Existing Local PostgreSQL

If PostgreSQL is already installed and running on the host, create the database/user if needed, then apply the migration with host `psql`.

### Option B: Docker PostgreSQL

This option runs PostgreSQL inside a container.
It does **not** install `psql` on the host.

That means you have two valid ways to manage the database:
- use `docker exec ... psql ...` inside the container
- install `postgresql-client` on the host and connect to the mapped port

Start a disposable local PostgreSQL 16 container:

```bash
docker run -d \
  --name agent-framework-memory-pg \
  -e POSTGRES_USER=agent_framework \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=agent_framework \
  -p 5432:5432 \
  postgres:16
```

If you want persistent Docker storage:

```bash
docker run -d \
  --name agent-framework-memory-pg \
  -e POSTGRES_USER=agent_framework \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=agent_framework \
  -p 5432:5432 \
  -v agent-framework-memory-pg:/var/lib/postgresql/data \
  postgres:16
```

Wait a few seconds, then verify connectivity.

#### Docker-native verification

```bash
docker exec -it agent-framework-memory-pg \
  psql -U agent_framework -d agent_framework -c 'select 1;'
```

#### Host `psql` verification

This only works if `psql` is installed on the host.

```bash
PGPASSWORD=change-me psql -h localhost -p 5432 -U agent_framework -d agent_framework -c 'select 1;'
```

## 5. Apply The Migration

### Option A: Apply With Host `psql`

```bash
PGPASSWORD=change-me psql \
  -h localhost \
  -p 5432 \
  -U agent_framework \
  -d agent_framework \
  -f migrations/001-init.sql
```

### Option B: Apply Through Docker

```bash
docker exec -i agent-framework-memory-pg \
  psql -U agent_framework -d agent_framework \
  < migrations/001-init.sql
```

Or use the helper script:

```bash
bash scripts/apply-migration-docker.sh
```

## 6. Verify The Schema

### With Host `psql`

```bash
PGPASSWORD=change-me psql \
  -h localhost \
  -p 5432 \
  -U agent_framework \
  -d agent_framework \
  -c "\dt memory.*"
```

### Through Docker

```bash
docker exec -it agent-framework-memory-pg \
  psql -U agent_framework -d agent_framework -c '\dt memory.*'
```

Expected tables:
- `memory.sessions`
- `memory.messages`
- `memory.work_reports`
- `memory.lessons`

## 7. Run Tests

```bash
npm test
```

## 8. Smoke-Check The CLI

Show usage:

```bash
node ./bin/mem.js
```

List sessions:

```bash
node ./bin/mem.js sessions
```

## Optional: Make `mem` Available As A Shell Command

If you want to run `mem` from anywhere instead of `node ./bin/mem.js`, there are two simple options.

### Option A: `npm link`

From the memory-service directory:

```bash
npm link
```

This exposes the package `bin` globally as `mem`.
It is convenient, but the global command will point at this specific workspace copy of `memory-service/`.
If you use multiple framework workspaces, only one linked copy can win at a time.

Verify:

```bash
which mem
mem sessions 1
```

### Option B: Shell Alias

Add an alias to your shell config instead of creating a global link:

```bash
alias mem='node /path/to/your/framework-workspace/framework/memory-service/bin/mem.js'
```

For example, place it in `~/.bashrc` or `~/.zshrc`, then reload the shell:

```bash
source ~/.bashrc
```

This is still workspace-specific, but it is explicit and easy to change later.

## 9. Import OpenCode Data From SQLite

The OpenCode adapter reads from the local SQLite database.
It requires the `sqlite3` CLI to be available on the machine running the import command.

Default current-workspace import with an explicit database path:

```bash
node ./bin/mem.js import-opencode-sqlite ~/.local/share/opencode/opencode.db
```

If `MEMORY_OPENCODE_DB_PATH` is set in `.env`, you can omit the path entirely:

```bash
node ./bin/mem.js import-opencode-sqlite
```

This imports only sessions whose OpenCode `session.directory` or `project.worktree` falls under `MEMORY_WORKSPACE_ROOT`.

Import all local OpenCode sessions instead:

```bash
node ./bin/mem.js import-opencode-sqlite --scope all
```

If `sqlite3` is not on your default `PATH`, point `MEMORY_SQLITE3_BIN` at the correct executable.

## 10. Query The Current Data

Direct invocation:

```bash
node ./bin/mem.js search "Plan"
node ./bin/mem.js recent 10
node ./bin/mem.js reports 10
node ./bin/mem.js sessions 10
```

If you set up `mem` as a shell command, the same queries become:

```bash
mem search "Plan"
mem recent 10
mem reports 10
mem sessions 10
```

## 11. Test Lessons

Add a lesson:

```bash
node ./bin/mem.js lessons add "Test lesson" \
  --desc "Remember to validate transcript shape first" \
  --category setup \
  --severity warning \
  --tags postgres,opencode \
  --project agent-framework \
  --work-item memory-service-v1
```

Search for it:

```bash
node ./bin/mem.js lessons search "validate transcript"
```

## Ubuntu Helper Script

This repository includes helper scripts:

- `scripts/setup-postgres-ubuntu.sh` — for host-installed PostgreSQL on Ubuntu
- `scripts/apply-migration-docker.sh` — for applying the migration to a running Docker PostgreSQL container

`setup-postgres-ubuntu.sh`:
- installs PostgreSQL if needed
- creates the database user
- creates the database
- grants privileges
- applies `migrations/001-init.sql`

`apply-migration-docker.sh`:
- expects a running Docker container with PostgreSQL already started
- applies `migrations/001-init.sql` inside that container
- verifies the created tables

Example:

```bash
sudo bash scripts/setup-postgres-ubuntu.sh
```

Optional overrides:

```bash
sudo DB_NAME=agent_framework \
  DB_USER=agent_framework \
  DB_PASSWORD=change-me \
  DB_HOST=localhost \
  DB_PORT=5432 \
  DB_SCHEMA=memory \
  bash scripts/setup-postgres-ubuntu.sh
```

Docker helper usage:

```bash
bash scripts/apply-migration-docker.sh
```

Optional Docker helper overrides:

```bash
CONTAINER_NAME=agent-framework-memory-pg \
DB_NAME=agent_framework \
DB_USER=agent_framework \
bash scripts/apply-migration-docker.sh
```

## Common Problems

### Authentication failure

Check:
- host
- port
- username/password
- whether PostgreSQL is listening on TCP or a local socket

### Schema permission issues

If the user can connect but cannot create schema objects, run as a privileged user:

```sql
CREATE SCHEMA IF NOT EXISTS memory AUTHORIZATION agent_framework;
GRANT ALL ON SCHEMA memory TO agent_framework;
```

### Search returns nothing

Possible causes:
- the import failed
- the SQLite DB path or `sqlite3` executable path is wrong
- the transcript shape differs from the current normalizer assumptions
- the transcript only contained ignored thinking/tool blocks

## Recommended Next Validation Step

After the sample import works, test with a real OpenCode transcript and refine normalization only where the real data requires it.
