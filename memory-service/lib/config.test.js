const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const { getConfig, resolvePathFromEnv } = require('./config');

test('resolvePathFromEnv expands home-relative paths', () => {
  assert.equal(resolvePathFromEnv('~/data/opencode.db'), path.join(os.homedir(), 'data/opencode.db'));
});

test('getConfig includes configurable OpenCode SQLite settings', () => {
  const config = getConfig(
    {
      MEMORY_WORKSPACE_ROOT: '/workspace/root',
      MEMORY_OPENCODE_DB_PATH: '~/sqlite/opencode.db',
      MEMORY_SQLITE3_BIN: '/usr/local/bin/sqlite3',
      MEMORY_PI_SESSIONS_ROOT: '~/.pi/agent/sessions',
    },
    '/fallback/cwd'
  );

  assert.equal(config.workspaceRoot, '/workspace/root');
  assert.equal(config.opencode.sqlitePath, path.join(os.homedir(), 'sqlite/opencode.db'));
  assert.equal(config.opencode.sqliteBin, '/usr/local/bin/sqlite3');
  assert.equal(config.pi.sessionsRoot, path.join(os.homedir(), '.pi/agent/sessions'));
});

test('getConfig falls back to cwd and default sqlite3 binary', () => {
  const config = getConfig({}, '/workspace/current');

  assert.equal(config.workspaceRoot, '/workspace/current');
  assert.equal(config.opencode.sqlitePath, null);
  assert.equal(config.opencode.sqliteBin, 'sqlite3');
  assert.equal(config.pi.sessionsRoot, null);
});
