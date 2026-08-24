export function readerSkeleton(session) {
  if (!session) return null;
  return {
    title: session.name || session.firstPrompt || session.id || 'Loading…',
    source: session.source,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    contextLoad: session.contextLoad,
  };
}
