import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupShellStateForTabs,
  setTabShellVisibility,
  terminalKeysForClosingTabs,
} from '../src/renderer/store/tab-state.ts';

test('removes shell state for closed tabs only', () => {
  const result = cleanupShellStateForTabs({ a: 'shell', b: 'agent' }, ['a']);

  assert.deepEqual(result, { b: 'agent' });
});

test('collects agent and opened shell keys for closed tabs', () => {
  const keys = terminalKeysForClosingTabs(
    ['copilot:C:\\repo', 'copilot:C:\\other'],
    {
      'copilot:C:\\repo': true,
      'copilot:C:\\other': false,
    },
    {
      'copilot:C:\\repo': 'bash',
    },
  );

  assert.deepEqual(keys, [
    'copilot:C:\\repo::agent',
    'copilot:C:\\repo::shell:bash',
    'copilot:C:\\other::agent',
  ]);
});

test('sets shell visibility for open tabs', () => {
  const result = setTabShellVisibility(['copilot:C:\\repo'], {}, 'copilot:C:\\repo', true);

  assert.deepEqual(result, { 'copilot:C:\\repo': true });
});

test('ignores shell visibility updates for tabs that are not open', () => {
  const current = { 'copilot:C:\\repo': true };
  const result = setTabShellVisibility(['copilot:C:\\other'], current, 'copilot:C:\\repo', false);

  assert.equal(result, current);
});

test('collects shell key for cleanup even when pane is hidden', () => {
  const keys = terminalKeysForClosingTabs(
    ['copilot:C:\\repo'],
    { 'copilot:C:\\repo': true },
    { 'copilot:C:\\repo': 'powershell' },
  );

  assert.deepEqual(keys, ['copilot:C:\\repo::agent', 'copilot:C:\\repo::shell:powershell']);
});
