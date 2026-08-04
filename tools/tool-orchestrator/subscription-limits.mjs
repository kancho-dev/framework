import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Retrieval-only subscription limits for Codex and Claude Code.
// Provider credentials and raw provider responses never leave this module:
// callers receive computed gauges only, and every failure degrades to a
// coarse `unavailable` reason instead of surfacing provider payloads.

export const WEEKLY_WINDOW_MINS = 10080;
export const CACHE_TTL_MS = 540_000;
const CODEX_TIMEOUT_MS = 8000;
const CLAUDE_TIMEOUT_MS = 5000;
const CLAUDE_API_BASE = 'https://api.anthropic.com';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

export const PROVIDERS = [
  { id: 'codex', label: 'Codex', windowLabel: 'Weekly', windowDurationMins: WEEKLY_WINDOW_MINS },
  { id: 'claude-code', label: 'Claude Code', windowLabel: 'Weekly (7 day)', windowDurationMins: WEEKLY_WINDOW_MINS },
  { id: 'claude-code-five-hour', label: 'Claude Code', windowLabel: '5 hour', windowDurationMins: 300 },
];

const CODEX = PROVIDERS[0];

// Both Claude windows come from a single usage response, so they share one read
// and fail together; Codex stays independent. Weekly leads so the two weekly
// gauges line up first and the five-hour one falls under Claude's weekly gauge.
const CLAUDE_WINDOWS = [
  { provider: PROVIDERS[1], key: 'seven_day', missingReason: 'no-weekly-window' },
  { provider: PROVIDERS[2], key: 'five_hour', missingReason: 'no-five-hour-window' },
];

function unavailable(provider, reason, asOf) {
  return { id: provider.id, label: provider.label, status: 'unavailable', remainingPercent: null, resetsAt: null, windowLabel: provider.windowLabel, windowDurationMins: provider.windowDurationMins, source: null, asOf, reason };
}

function gauge(provider, remainingPercent, resetsAt, asOf) {
  return { id: provider.id, label: provider.label, status: 'ok', remainingPercent, resetsAt, windowLabel: provider.windowLabel, windowDurationMins: provider.windowDurationMins, source: 'provider-reported', asOf, reason: null };
}

function displayRemaining(usedPercent) {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null;
  return Math.min(100, Math.max(0, Math.round(100 - usedPercent)));
}

function isoFromSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function isoFromValue(value) {
  if (typeof value === 'number') return isoFromSeconds(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Pick the weekly bucket by window duration or provider identity. `primary`
 * position is deliberately not trusted: Codex reports whichever bucket is most
 * constraining there, which is often the five-hour window.
 */
export function selectCodexWeeklyWindow(response) {
  const snapshots = codexSnapshots(response);
  for (const snapshot of snapshots) {
    for (const window of [snapshot?.primary, snapshot?.secondary]) {
      if (window && window.windowDurationMins === WEEKLY_WINDOW_MINS) return window;
    }
  }
  return null;
}

function codexSnapshots(response) {
  const byLimitId = response?.rateLimitsByLimitId;
  const extra = byLimitId && typeof byLimitId === 'object' ? Object.values(byLimitId) : [];
  return [response?.rateLimits, ...extra].filter((snapshot) => snapshot && typeof snapshot === 'object');
}

export function codexGauge(response, asOf) {
  if (!response || typeof response !== 'object') return unavailable(CODEX, 'no-data', asOf);
  const window = selectCodexWeeklyWindow(response);
  if (!window) return unavailable(CODEX, 'no-weekly-window', asOf);
  const remainingPercent = displayRemaining(window.usedPercent);
  if (remainingPercent === null) return unavailable(CODEX, 'no-weekly-window', asOf);
  return gauge(CODEX, remainingPercent, isoFromSeconds(window.resetsAt), asOf);
}

function claudeWindowGauge(usage, asOf, { provider, key, missingReason }) {
  if (!usage || typeof usage !== 'object') return unavailable(provider, 'no-data', asOf);
  const window = usage[key];
  if (!window || typeof window !== 'object') return unavailable(provider, missingReason, asOf);
  const remainingPercent = displayRemaining(window.utilization);
  if (remainingPercent === null) return unavailable(provider, missingReason, asOf);
  return gauge(provider, remainingPercent, isoFromValue(window.resets_at), asOf);
}

export function claudeGauges(usage, asOf) {
  return CLAUDE_WINDOWS.map((window) => claudeWindowGauge(usage, asOf, window));
}

async function withTimeout(promise, ms, onTimeout) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new Error('timeout')); }, ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Codex app-server read: initialize, call the retrieval-only rate-limit method,
 * exit. No thread and no turn are ever started, so no model is invoked.
 */
export function readCodexRateLimits({ command = 'codex' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let settled = false;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(value);
    };
    timer = setTimeout(() => finish(new Error('codex-timeout')), CODEX_TIMEOUT_MS);
    child.on('error', () => finish(new Error('codex-unavailable')));
    child.stdin.on('error', () => finish(new Error('codex-unavailable')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} })}\n`);
        if (message.id === 2) finish(message.error ? new Error('codex-request-failed') : null, message.result);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'framework-cockpit', version: '1' }, capabilities: { experimentalApi: true } } })}\n`);
  });
}

async function readClaudeToken(claudeHome) {
  // A missing/unreadable store is the normal Keychain/DPAPI or signed-out case.
  const raw = await readFile(join(claudeHome, '.credentials.json'), 'utf8').catch(() => { throw new Error('claude-no-token'); });
  const parsed = JSON.parse(raw);
  const oauth = parsed?.claudeAiOauth;
  if (!oauth?.accessToken) throw new Error('claude-no-token');
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now()) throw new Error('claude-token-expired');
  return oauth.accessToken;
}

/**
 * Claude Code's own local OAuth token is read at request time and stays in this
 * function's scope: it is never logged, persisted, cached, or returned.
 */
export async function readClaudeUsage({ claudeHome = process.env.CLAUDE_HOME || join(homedir(), '.claude'), fetchImpl = fetch } = {}) {
  const token = await readClaudeToken(claudeHome);
  const controller = new AbortController();
  const response = await withTimeout(
    fetchImpl(`${CLAUDE_API_BASE}/api/oauth/usage`, {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': CLAUDE_OAUTH_BETA, 'content-type': 'application/json' },
      signal: controller.signal,
    }),
    CLAUDE_TIMEOUT_MS,
    () => controller.abort(),
  );
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'claude-auth-rejected' : 'claude-request-failed');
  return response.json();
}

function reasonFor(error) {
  const known = new Set(['codex-unavailable', 'codex-timeout', 'codex-request-failed', 'claude-no-token', 'claude-token-expired', 'claude-auth-rejected', 'claude-request-failed', 'timeout']);
  const message = error instanceof Error ? error.message : '';
  return known.has(message) ? message : 'unreadable';
}

async function providerGauges(providers, read, build, asOf) {
  try {
    return build(await read(), asOf);
  } catch (error) {
    const reason = reasonFor(error);
    return providers.map((provider) => unavailable(provider, reason, asOf));
  }
}

export async function subscriptionLimits({ readCodex = readCodexRateLimits, readClaude = readClaudeUsage, now = () => new Date() } = {}) {
  const asOf = now().toISOString();
  const [codex, claude] = await Promise.all([
    providerGauges([CODEX], readCodex, (response, at) => [codexGauge(response, at)], asOf),
    providerGauges(CLAUDE_WINDOWS.map((window) => window.provider), readClaude, claudeGauges, asOf),
  ]);
  return { asOf, refreshIntervalMs: 600_000, providers: [...codex, ...claude] };
}

export function createSubscriptionLimitsReader(options = {}) {
  let cached = null;
  let inFlight = null;
  return async function read({ force = false } = {}) {
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (fresh && !force) return cached.value;
    if (inFlight) return inFlight;

    inFlight = subscriptionLimits(options)
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
