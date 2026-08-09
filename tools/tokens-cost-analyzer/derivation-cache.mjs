import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write.mjs';

export const DERIVATION_CACHE_DIRNAME = 'derivation-cache';

export function createDerivationCache({ outDir, generatorVersion, pricingFingerprint, contextFingerprint }) {
  const cacheDir = join(outDir, DERIVATION_CACHE_DIRNAME);
  const derivation = { generatorVersion, pricingFingerprint, contextFingerprint };

  return async function deriveSource({ source, path, changeSignal, derive, nativeIdOf, restoreNativeId }) {
    const identity = changeSignal == null
      ? await fileIdentity(source, path)
      : { source, path, changeSignal };
    const shardPath = join(cacheDir, source, `${createHash('sha256').update(path).digest('hex')}.json`);
    const cached = await readShard(shardPath);
    if (matches(cached, identity, derivation)) {
      cached.records.forEach((record, index) => restoreNativeId(record, cached.nativeMessageIds[index]));
      return { records: cached.records, reused: true };
    }

    const records = await derive();
    const shard = {
      schemaVersion: 1,
      identity,
      derivation,
      records,
      nativeMessageIds: records.map(nativeIdOf),
    };
    await mkdir(join(cacheDir, source), { recursive: true });
    await atomicWrite(shardPath, JSON.stringify(shard));
    return { records, reused: false };
  };
}

async function readShard(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function matches(shard, identity, derivation) {
  return shard?.schemaVersion === 1
    && Array.isArray(shard.records)
    && Array.isArray(shard.nativeMessageIds)
    && shard.nativeMessageIds.length === shard.records.length
    && Object.entries(identity).every(([key, value]) => shard.identity?.[key] === value)
    && shard.derivation?.generatorVersion === derivation.generatorVersion
    && shard.derivation?.pricingFingerprint === derivation.pricingFingerprint
    && shard.derivation?.contextFingerprint === derivation.contextFingerprint;
}

async function fileIdentity(source, path) {
  const sourceStat = await stat(path);
  return { source, path, mtimeMs: sourceStat.mtimeMs, size: sourceStat.size };
}
