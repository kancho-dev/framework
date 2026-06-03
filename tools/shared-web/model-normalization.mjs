export function normalizeModelProvider(source, provider) {
  if (source === 'pi' && provider === 'openai-codex') return 'openai';
  return provider || '';
}

export function modelLabelFromParts({ source, provider, model, variant } = {}) {
  if (!model) return '';
  const normalizedProvider = normalizeModelProvider(source, provider);
  return `${normalizedProvider ? `${normalizedProvider}/` : ''}${model}${variant ? `:${variant}` : ''}`;
}

export function parseOpenCodeModel(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return {
      source: 'opencode',
      provider: parsed?.providerID || '',
      model: parsed?.id || parsed?.modelID || parsed?.model || '',
      variant: parsed?.variant || '',
      rawProvider: parsed?.providerID || '',
      rawModel: parsed?.id || parsed?.modelID || parsed?.model || '',
      rawVariant: parsed?.variant || '',
    };
  } catch {}
  return { source: 'opencode', provider: '', model: String(value), variant: '', rawProvider: '', rawModel: String(value), rawVariant: '' };
}

export function openCodeMessageModelParts(message) {
  const data = message?.data || message || {};
  return {
    source: 'opencode',
    provider: data.providerID || '',
    model: data.modelID || data.model || '',
    variant: data.variant || '',
    rawProvider: data.providerID || '',
    rawModel: data.modelID || data.model || '',
    rawVariant: data.variant || '',
  };
}

export function piModelState(entries) {
  const state = { source: 'pi', provider: '', model: '', variant: '', rawProvider: '', rawModel: '', rawVariant: '' };
  for (const entry of entries) {
    if (entry?.type === 'model_change') {
      state.provider = entry.provider || '';
      state.model = entry.modelId || entry.model || '';
      state.rawProvider = state.provider;
      state.rawModel = state.model;
    } else if (entry?.type === 'thinking_level_change') {
      state.variant = entry.thinkingLevel || '';
      state.rawVariant = state.variant;
    }
  }
  return { ...state, label: modelLabelFromParts(state) };
}
