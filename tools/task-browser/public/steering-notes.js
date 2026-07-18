export function isSteeringNotesInput(name) {
  return name === 'steeringNotes';
}

export function steeringDisclosureOpen({ preference, pending, dirty }) {
  return preference === undefined ? Boolean(pending || dirty) : Boolean(preference || dirty);
}

export function syncSteeringDraft(drafts, task) {
  const saved = task.steeringNotes || { content: '', revision: '' };
  const current = drafts[task.key];
  if (!current || !current.dirty) {
    drafts[task.key] = { content: saved.content, revision: saved.revision, dirty: false, state: saved.content.trim() ? 'saved' : 'cleared', message: '' };
  } else if (current.revision !== saved.revision) {
    current.state = 'conflict';
    current.message = 'The saved note changed or was consumed. Your draft is preserved; refresh it before saving.';
  }
  return drafts[task.key];
}

export function editSteeringDraft(draft, content) {
  return { ...draft, content, dirty: true, state: 'dirty', message: 'Unsaved draft.' };
}

export function pendingSteeringIndicator(pending) {
  return pending ? '<span class="steering-pending" title="Steering Notes pending for the next Task Run" aria-label="Steering Notes pending"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5"/></svg></span>' : '';
}

export function savedSteeringDraft(note) {
  return { content: note.content, revision: note.revision, dirty: false, state: note.content.trim() ? 'saved' : 'cleared', message: note.content.trim() ? 'Saved for the next Task Run.' : 'Steering Notes cleared.' };
}
