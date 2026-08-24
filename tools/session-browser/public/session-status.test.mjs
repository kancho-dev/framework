import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionStatusView } from './session-status.js';

test('keeps the ordinary session status concise when archive notices exist', () => {
  const view = sessionStatusView({
    visibleCount: 1024,
    totalCount: 1024,
    workspaceName: 'Framework Workspace',
    unmappedSessions: [{ machineId: 'precision-3571', label: 'Precision 3571', count: 355 }],
    errors: ['legacy-config unavailable: Shared archive mode ignores workspace-local machine config: /work/machines.json'],
  });
  assert.equal(view.primary, '1024 of 1024 sessions · Framework Workspace');
  assert.equal(view.noticeSummary, '2 archive notices');
  assert.deepEqual(view.notices, [
    'Precision 3571: 355 archived sessions from other workspaces (not shown)',
    'legacy-config unavailable: Shared archive mode ignores workspace-local machine config: /work/machines.json',
  ]);
});

test('omits the disclosure summary when there are no notices', () => {
  const view = sessionStatusView({ visibleCount: 4, totalCount: 5, workspaceName: 'Global', archivesLoading: true });
  assert.equal(view.primary, '4 of 5 sessions · Global · loading archived sessions…');
  assert.equal(view.noticeSummary, '0 archive notices');
  assert.deepEqual(view.notices, []);
});
