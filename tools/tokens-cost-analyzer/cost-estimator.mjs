const RATE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const THRESHOLD_FIELDS = ['input', 'cacheRead', 'cacheWrite'];

export const COST_ESTIMATOR_VERSION = 2;

export function estimateCost(tokens, price, options = {}) {
  const warnings = [];
  const omittedTokenWarnings = new Set(options.omittedTokenWarnings || []);
  if (!price) return { cost: null, class: 'unknown', warnings: ['unpriced model'] };

  const selected = selectRates(tokens, price, omittedTokenWarnings);
  if (selected.warning) warnings.push(selected.warning);

  let cost = 0;
  for (const field of RATE_FIELDS) {
    const value = tokens[field].value;
    if (value == null) {
      if (!omittedTokenWarnings.has(field)) warnings.push(`unknown ${field} tokens`);
      continue;
    }
    if (selected.rates[field] == null) {
      if (value > 0) warnings.push(`unpriced ${field} tokens`);
      continue;
    }
    cost += (value / 1_000_000) * Number(selected.rates[field]);
  }
  return { cost: Number(cost.toFixed(6)), class: warnings.length ? 'estimated-partial' : 'estimated', warnings };
}

function selectRates(tokens, price, omittedTokenWarnings) {
  if (price.tiers == null || (Array.isArray(price.tiers) && price.tiers.length === 0)) return { rates: price };
  if (!validTiers(price.tiers)) return { rates: price, warning: 'unsupported tiered pricing; estimate uses base rates' };

  const thresholdValues = THRESHOLD_FIELDS.map((field) => {
    const value = tokens[field]?.value;
    return value == null && omittedTokenWarnings.has(field) ? 0 : value;
  });
  if (thresholdValues.some((value) => value == null)) {
    return { rates: price, warning: 'unknown tier threshold tokens; estimate uses base rates' };
  }

  const totalInput = thresholdValues.reduce((sum, value) => sum + Number(value), 0);
  const matched = price.tiers
    .filter((tier) => totalInput > tier.inputTokensAbove)
    .sort((left, right) => right.inputTokensAbove - left.inputTokensAbove)[0];
  return { rates: matched || price };
}

function validTiers(tiers) {
  if (!Array.isArray(tiers)) return false;
  const thresholds = new Set();
  return tiers.every((tier) => {
    if (!tier || !validNumber(tier.inputTokensAbove) || thresholds.has(tier.inputTokensAbove)) return false;
    thresholds.add(tier.inputTokensAbove);
    return RATE_FIELDS.every((field) => validNumber(tier[field]));
  });
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
