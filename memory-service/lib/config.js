const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function getConfig() {
  return {
    db: {
      host: process.env.MEMORY_DB_HOST || 'localhost',
      port: Number.parseInt(process.env.MEMORY_DB_PORT || '5432', 10),
      database: process.env.MEMORY_DB_NAME || 'agent_framework',
      user: process.env.MEMORY_DB_USER || 'agent_framework',
      password: process.env.MEMORY_DB_PASSWORD || '',
      schema: process.env.MEMORY_DB_SCHEMA || 'memory',
    },
    workspace: process.env.MEMORY_WORKSPACE || 'default-workspace',
    workspaceRoot: process.env.MEMORY_WORKSPACE_ROOT || process.cwd(),
  };
}

module.exports = {
  getConfig,
};
