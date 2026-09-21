import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentTerminalKey,
  makeSessionTabKey,
  parseSessionTabKey,
  sessionTabLabelSuffix,
  shellTerminalKey,
  isTerminalKeyForProject,
  terminalKeysForProject,
} from '../src/shared/session-terminals.ts';

test('builds an agent terminal key for a project', () => {
  assert.equal(agentTerminalKey('copilot:C:\\repo'), 'copilot:C:\\repo::agent');
});

test('builds a shell terminal key with profile', () => {
  assert.equal(
    shellTerminalKey('copilot:C:\\repo', 'powershell'),
    'copilot:C:\\repo::shell:powershell',
  );
});

test('returns all known terminal keys for one tab', () => {
  assert.deepEqual(terminalKeysForProject('copilot:C:\\repo', ['powershell', 'bash']), [
    'copilot:C:\\repo::agent',
    'copilot:C:\\repo::shell:powershell',
    'copilot:C:\\repo::shell:bash',
  ]);
});

test('matches terminal keys to owning project', () => {
  assert.equal(isTerminalKeyForProject('copilot:C:\\repo::agent', 'copilot:C:\\repo'), true);
  assert.equal(isTerminalKeyForProject('copilot:C:\\other::agent', 'copilot:C:\\repo'), false);
});

test('builds a session tab key for project and session', () => {
  assert.equal(
    makeSessionTabKey('copilot:C:\\repo', 'session-123'),
    'copilot:C:\\repo::session:session-123',
  );
});

test('parses session tab keys into project and session ids', () => {
  assert.deepEqual(parseSessionTabKey('copilot:C:\\repo::session:session-123'), {
    projectId: 'copilot:C:\\repo',
    sessionId: 'session-123',
  });
});

test('treats plain project keys as non-session tabs', () => {
  assert.deepEqual(parseSessionTabKey('copilot:C:\\repo'), {
    projectId: 'copilot:C:\\repo',
    sessionId: null,
  });
});

test('uses title-first tab label suffix with short-id fallback', () => {
  assert.equal(sessionTabLabelSuffix('Daily sync', 'session-abcdef'), 'Daily sync');
  assert.equal(sessionTabLabelSuffix('', 'session-abcdef'), 'session-a');
});
