import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

export const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
]);

export function normalizeBasePath(basePath = '/') {
  if (!basePath || basePath === '/') return '';
  const withStart = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withStart.endsWith('/') ? withStart.slice(0, -1) : withStart;
}

export function stripBasePath(pathname, basePath = '') {
  const base = normalizeBasePath(basePath);
  if (!base) return pathname || '/';
  if (pathname === base) return '/';
  if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length) || '/';
  return null;
}

export function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

export function safeError(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

export async function readStaticText(publicDir, pathname) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(publicDir, decodeURIComponent(safePathname));
  const resolved = resolve(filePath);
  if (!resolved.startsWith(`${publicDir}/`) && resolved !== join(publicDir, 'index.html')) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  }
  return readFile(resolved, 'utf8');
}

export async function serveStaticPath(res, publicDir, pathname) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(publicDir, decodeURIComponent(safePathname));
  const resolved = resolve(filePath);
  if (!resolved.startsWith(`${publicDir}/`) && resolved !== join(publicDir, 'index.html')) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  if (!(await exists(resolved))) return sendJson(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': mime.get(extname(resolved)) || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(resolved).pipe(res);
}
