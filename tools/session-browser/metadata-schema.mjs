export const METADATA_VERSION = 3;

export function emptyMetadata() {
  return { version: METADATA_VERSION, sessions: {} };
}
