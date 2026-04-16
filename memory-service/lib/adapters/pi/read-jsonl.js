const fs = require('fs');
const path = require('path');

function readJsonlFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function findPiSessionFiles(rootPath) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...findPiSessionFiles(fullPath));
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  });

  return files.sort();
}

function readPiSessions(rootPath) {
  return findPiSessionFiles(rootPath).map((filePath) => ({
    filePath,
    records: readJsonlFile(filePath),
  }));
}

module.exports = {
  findPiSessionFiles,
  readJsonlFile,
  readPiSessions,
};
