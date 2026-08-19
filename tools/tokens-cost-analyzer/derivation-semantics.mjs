import { createHash } from 'node:crypto';
import { COST_ESTIMATOR_VERSION } from './cost-estimator.mjs';

/**
 * Identity of the *derivation semantics* — how a session file becomes a record.
 *
 * The derivation cache stores fully parsed and priced records per source file, keyed on file
 * identity plus a fingerprint set. File mtime/size covers changed input; `pricingFingerprint`
 * covers changed rates; `COST_ESTIMATOR_VERSION` covers changed cost arithmetic. This constant
 * covers everything else that turns a file into a record.
 *
 * INCREMENT THIS whenever adapter parsing, field extraction, record shaping, or any value derived
 * onto a record changes — `parsePiSession`, `parseCodexSession`, `deriveOpenCodeRecords`, and the
 * shaping around them in `analyze.mjs`. Without an increment, every warm shard keeps serving the
 * old records until the source file's mtime changes, which for an archived or retired session
 * store is never.
 *
 * Deliberately NOT the package version. The release number follows release cadence — this
 * workspace routinely leaves a tool version untouched while it sits unreleased inside a framework
 * release — and cache correctness must not depend on that decision going a particular way.
 */
export const DERIVATION_SEMANTICS_VERSION = 1;

/**
 * Compose the derivation cache's `contextFingerprint`. Every input that changes derived record
 * values without changing the source file must appear here, or warm shards survive a change they
 * should not have survived.
 */
export function derivationContextFingerprint({
  scopes,
  costEstimatorVersion = COST_ESTIMATOR_VERSION,
  derivationSemanticsVersion = DERIVATION_SEMANTICS_VERSION,
} = {}) {
  const text = JSON.stringify({ scopes, costEstimatorVersion, derivationSemanticsVersion });
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
