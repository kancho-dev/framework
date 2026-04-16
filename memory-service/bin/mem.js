#!/usr/bin/env node
const { withPool } = require('../lib/db');
const { importOpenCodeSqlite } = require('../lib/adapters/opencode/import');
const {
  addLesson,
  listReports,
  listSessions,
  recentMessages,
  searchLessons,
  searchMessages,
} = require('../lib/queries');

function usage() {
  console.log(`Usage:
  mem import-opencode-sqlite [db-path] [--scope workspace|all]
  mem search "query"
  mem recent [count]
  mem reports [count]
  mem sessions [count]
  mem lessons search "query"
  mem lessons add <title> --desc "..." [--category bug] [--severity warning] [--tags a,b] [--project name] [--work-item slug]`);
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) continue;
    flags[value.slice(2)] = args[index + 1];
    index += 1;
  }
  return flags;
}

function positionalArgs(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  await withPool(async (pool, config) => {
    const schema = config.db.schema;

    switch (command) {
      case 'import-opencode-sqlite': {
        const importArgs = args.slice(1);
        const flags = parseFlags(importArgs);
        const dbPath = positionalArgs(importArgs)[0] || config.opencode.sqlitePath;
        if (!dbPath) {
          throw new Error('Missing OpenCode SQLite database path. Pass [db-path] or set MEMORY_OPENCODE_DB_PATH');
        }
        const scope = flags.scope || 'workspace';
        if (!['workspace', 'all'].includes(scope)) {
          throw new Error('Invalid --scope value. Use workspace or all');
        }
        const result = await importOpenCodeSqlite(pool, config, dbPath, scope);
        console.log(`OpenCode import complete (scope: ${result.scope})`);
        console.log(`  SQLite DB: ${dbPath}`);
        console.log(`  Sessions scanned: ${result.scannedSessions}`);
        console.log(`  Sessions in scope: ${result.eligibleSessions}`);
        console.log(`  Sessions inserted: ${result.sessionsInserted}`);
        console.log(`  Sessions updated: ${result.sessionsUpdated}`);
        console.log(`  Sessions unchanged: ${result.sessionsUnchanged}`);
        console.log(`  Messages inserted: ${result.messagesInserted}`);
        console.log(`  Messages updated: ${result.messagesUpdated}`);
        console.log(`  Messages unchanged: ${result.messagesUnchanged}`);
        console.log(`  Work reports inserted: ${result.workReportsInserted}`);
        console.log(`  Work reports updated: ${result.workReportsUpdated}`);
        console.log(`  Work reports unchanged: ${result.workReportsUnchanged}`);
        return;
      }
      case 'search': {
        const query = args.slice(1).join(' ').trim();
        if (!query) throw new Error('Missing search query');
        await searchMessages(pool, schema, query);
        return;
      }
      case 'recent':
        await recentMessages(pool, schema, Number.parseInt(args[1] || '20', 10));
        return;
      case 'reports':
        await listReports(pool, schema, Number.parseInt(args[1] || '10', 10));
        return;
      case 'sessions':
        await listSessions(pool, schema, Number.parseInt(args[1] || '20', 10));
        return;
      case 'lessons': {
        const subcommand = args[1];
        if (subcommand === 'search') {
          const query = args.slice(2).join(' ').trim();
          if (!query) throw new Error('Missing lessons search query');
          await searchLessons(pool, schema, query);
          return;
        }

        if (subcommand === 'add') {
          const flags = parseFlags(args.slice(2));
          const title = positionalArgs(args.slice(2)).join(' ').trim();
          if (!title || !flags.desc) {
            throw new Error('Lesson add requires a title and --desc');
          }

          await addLesson(pool, schema, config.workspace, {
            title,
            description: flags.desc,
            category: flags.category || null,
            severity: flags.severity || 'warning',
            tags: flags.tags ? flags.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
            relatedProject: flags.project || null,
            relatedWorkItem: flags['work-item'] || null,
            createdBy: 'cli',
          });
          return;
        }

        throw new Error('Unknown lessons subcommand');
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  usage();
  process.exitCode = 1;
});
