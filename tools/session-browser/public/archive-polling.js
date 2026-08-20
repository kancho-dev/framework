export const ARCHIVE_POLL_DELAY_MS = 750;

export function shouldPollArchives(data) {
  return Boolean(data?.archivesLoading);
}
