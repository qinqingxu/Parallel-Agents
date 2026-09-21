import assert from 'node:assert/strict';
import test from 'node:test';

import {
  removeProjectsFromSnapshot,
  stabilizeCopilotProjects,
  validateMissingProjectIds,
} from '../src/main/project-policies.ts';

const project = (id, exists = false, agent = 'copilot') => ({
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

test('keeps the previous Copilot snapshot when every candidate fails', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  const result = stabilizeCopilotProjects(previous, {
    projects: [],
    valid: true,
    candidateCount: 3,
    parsedCount: 0,
  });

  assert.deepEqual(result, previous);
});

test('accepts a legitimate empty Copilot inventory', () => {
  const result = stabilizeCopilotProjects([project('copilot:old')], {
    projects: [],
    valid: true,
    candidateCount: 0,
    parsedCount: 0,
  });

  assert.deepEqual(result, []);
});

test('accepts valid projects while ignoring malformed candidates', () => {
  const current = [project('copilot:C:\\work\\beta')];
  const result = stabilizeCopilotProjects([], {
    projects: current,
    valid: true,
    candidateCount: 2,
    parsedCount: 1,
  });

  assert.deepEqual(result, current);
});

test('keeps the previous Copilot snapshot when the session root is temporarily unreadable', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  const result = stabilizeCopilotProjects(previous, {
    projects: [],
    valid: false,
    candidateCount: 0,
    parsedCount: 0,
  });

  assert.deepEqual(result, previous);
});

test('removes deleted project IDs from a retained snapshot', () => {
  const a = project('copilot:C:\\work\\alpha');
  const b = project('copilot:C:\\work\\beta');

  assert.deepEqual(removeProjectsFromSnapshot([a, b], [a.id]), [b]);
});

test('validates a unique set of missing deletable projects', () => {
  const a = project('copilot:C:\\work\\gone-a');
  const b = project('claude:C--work-gone-b', false, 'claude');
  const c = project('codex:C:\\work\\gone-c', false, 'codex');

  assert.deepEqual(validateMissingProjectIds([a, b, c], [a.id, b.id, c.id, a.id]), [a, b, c]);
});

test('rejects bulk deletion when a working directory still exists', () => {
  const active = project('copilot:C:\\work\\active', true);

  assert.throws(() => validateMissingProjectIds([active], [active.id]), /not missing/);
});

test('rejects unknown and unsupported projects', () => {
  const aider = project('aider:C:\\work\\gone', false, 'aider');

  assert.throws(() => validateMissingProjectIds([aider], [aider.id]), /not supported/);
  assert.throws(() => validateMissingProjectIds([], ['copilot:unknown']), /Unknown project/);
});
