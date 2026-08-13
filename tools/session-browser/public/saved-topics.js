export function topicRows(anchors = [], savedTopics = {}, savedOnly = false) {
  const hasSavedTopics = Object.keys(savedTopics).length > 0;
  return anchors
    .filter((anchor) => !savedOnly || !hasSavedTopics || Boolean(savedTopics[anchor.id]))
    .map((anchor) => ({ ...anchor, saved: savedTopics[anchor.id] || null }));
}

export function matchesSavedTopicSessionFilter(session, enabled) {
  return !enabled || Number(session?.metadata?.savedTopicCount || 0) > 0;
}

export function savedTopicNoteIndicator(topic) {
  return topic?.note?.trim()
    ? '<span class="saved-topic-note" title="Has note" aria-label="Has note"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5"/></svg></span>'
    : '';
}

export function savedTopicPromptAction(topicId, savedTopics = {}) {
  const saved = Boolean(savedTopics[topicId]);
  return { saved, label: saved ? 'Edit saved' : 'Save' };
}

export function savedTopicDestination(anchors = [], savedTopics = {}, topicId) {
  if (!savedTopics[topicId] || !anchors.some((anchor) => anchor.id === topicId)) return null;
  return { topicId };
}
