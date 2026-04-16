const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function resolveOpenCodeDbPath(value) {
  if (!value) return null;
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function getConfig(env = process.env, cwd = process.cwd()) {
  return {
    db: {
      host: env.MEMORY_DB_HOST || 'localhost',
      port: Number.parseInt(env.MEMORY_DB_PORT || '5432', 10),
      database: env.MEMORY_DB_NAME || 'agent_framework',
      user: env.MEMORY_DB_USER || 'agent_framework',
      password: env.MEMORY_DB_PASSWORD || '',
      schema: env.MEMORY_DB_SCHEMA || 'memory',
    },
    workspace: env.MEMORY_WORKSPACE || 'default-workspace',
    workspaceRoot: env.MEMORY_WORKSPACE_ROOT || cwd,
    opencode: {
      sqlitePath: resolveOpenCodeDbPath(env.MEMORY_OPENCODE_DB_PATH),
      sqliteBin: env.MEMORY_SQLITE3_BIN || 'sqlite3',
    },
  };
}

module.exports = {
  getConfig,
  resolveOpenCodeDbPath,
};
