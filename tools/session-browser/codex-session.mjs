import { basename } from 'node:path';

export function codexSessionIdFromFile(file) {
  const name = basename(file, '.jsonl');
  return name.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/)?.[1] || name;
}
