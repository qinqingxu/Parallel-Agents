import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabIds, omitRecordKeys, tabKeysForProject } from '../src/renderer/store/tab-state.ts';

test('closing other tabs keeps the target active', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'a', ['a', 'c']), {
    openTabs: ['b'],
    activeTabId: 'b',
  });
});

test('closing all tabs clears the active tab', () => {
  assert.deepEqual(closeTabIds(['a', 'b'], 'b', ['a', 'b']), { openTabs: [], activeTabId: null });
});

test('closing an active tab selects its next neighbor', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'b', ['b']), {
    openTabs: ['a', 'c'],
    activeTabId: 'c',
  });
});

test('closing tabs does not change an active tab that remains open', () => {
  assert.deepEqual(closeTabIds(['a', 'b', 'c'], 'b', ['a', 'c']), {
    openTabs: ['b'],
    activeTabId: 'b',
  });
});

test('removes closed tab keys from tab-specific state', () => {
  assert.deepEqual(omitRecordKeys({ a: 1, b: 2, c: 3 }, ['a', 'c']), { b: 2 });
});

test('returns all tab keys that belong to the same project', () => {
  const result = tabKeysForProject(
    {
      'copilot:C:\\repo': 'copilot:C:\\repo',
      'copilot:C:\\repo::session:a': 'copilot:C:\\repo',
      'copilot:C:\\other::session:b': 'copilot:C:\\other',
    },
    'copilot:C:\\repo',
  );

  assert.deepEqual(result, ['copilot:C:\\repo', 'copilot:C:\\repo::session:a']);
});
