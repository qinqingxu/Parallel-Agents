import assert from 'node:assert/strict';
import test from 'node:test';
import { applySessionNames, validateSessionName } from '../src/shared/session-presentation.ts';

test('uses the same persisted name for history and tabs across agents', () => {
  const session = { id: 'one', agent: 'codex', title: 'Original' };
  assert.equal(applySessionNames([session], { 'codex:one': 'New title' })[0].title, 'New title');
  assert.equal(applySessionNames([session], { 'copilot:one': 'Other' })[0].title, 'Original');
  assert.equal(session.title, 'Original');
  assert.equal(validateSessionName('  修复 Session 标题  '), '修复 Session 标题');
  assert.throws(() => validateSessionName('a\nb'), /single line/i);
});
