import assert from 'node:assert/strict';
import test from 'node:test';

import { pickDeletableMissingProjectIds } from '../src/renderer/store/project-cleanup.ts';

const project = (id, { exists = false, agent = 'copilot' } = {}) => ({
  id,
  agent,
  dirName: id.slice(id.indexOf(':') + 1),
  realPath: `C:\\work\\${id}`,
  displayName: id,
  exists,
  pinned: false,
  hidden: false,
  sessionCount: 1,
  lastActivity: 1,
});

test('keeps only unique deletable missing project IDs', () => {
  const missingA = project('copilot:C:\\work\\gone-a');
  const missingB = project('claude:C--work-gone-b', { agent: 'claude' });
  const active = project('copilot:C:\\work\\active', { exists: true });
  const unsupported = project('aider:C:\\work\\gone-c', { agent: 'aider' });

  const result = pickDeletableMissingProjectIds(
    [missingA, missingB, active, unsupported],
    [missingA.id, missingB.id, active.id, unsupported.id, missingA.id, 'copilot:unknown'],
  );

  assert.deepEqual(result, [missingA.id, missingB.id]);
});

test('returns empty when no candidate is currently deletable and missing', () => {
  const active = project('copilot:C:\\work\\active', { exists: true });
  const unsupported = project('aider:C:\\work\\gone', { agent: 'aider' });

  const result = pickDeletableMissingProjectIds([active, unsupported], [active.id, unsupported.id]);

  assert.deepEqual(result, []);
});

test('includes missing Codex projects offered by the cleanup UI', () => {
  const codex = project('codex:C:\\work\\gone', { agent: 'codex' });
  assert.deepEqual(pickDeletableMissingProjectIds([codex], [codex.id]), [codex.id]);
});
