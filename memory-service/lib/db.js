const { Pool } = require('pg');
const { getConfig } = require('./config');

function createPool() {
  const config = getConfig();
  return new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  });
}

async function withPool(fn) {
  const pool = createPool();
  try {
    return await fn(pool, getConfig());
  } finally {
    await pool.end();
  }
}

module.exports = {
  createPool,
  withPool,
};
