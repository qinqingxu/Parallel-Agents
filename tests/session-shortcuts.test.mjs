import assert from 'node:assert/strict';
import test from 'node:test';
import { nextSessionTab } from '../src/renderer/store/tab-state.ts';
import { handleSessionTabShortcut } from '../src/renderer/session-shortcuts.ts';

test('Ctrl+Tab order wraps forward and backward without modifying tabs', () => {
  const tabs = ['one', 'two', 'three'];
  assert.equal(nextSessionTab(tabs, 'one'), 'two');
  assert.equal(nextSessionTab(tabs, 'three'), 'one');
  assert.equal(nextSessionTab(tabs, 'one', true), 'three');
  assert.equal(nextSessionTab(tabs, 'three', true), 'two');
  assert.deepEqual(tabs, ['one', 'two', 'three']);
});

test('tab cycling handles empty, single, and missing active tabs', () => {
  assert.equal(nextSessionTab([], null), null);
  assert.equal(nextSessionTab(['one'], 'one'), 'one');
  assert.equal(nextSessionTab(['one', 'two'], null), 'one');
  assert.equal(nextSessionTab(['one', 'two'], 'missing', true), 'two');
});

test('Ctrl+Tab is consumed before terminal input and ignored during modal confirmation', () => {
  let prevented = 0;
  let stopped = 0;
  const active = [];
  const event = {
    key: 'Tab',
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  };
  handleSessionTabShortcut(event, ['one', 'two'], 'one', (id) => active.push(id), false);
  assert.deepEqual(active, ['two']);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  handleSessionTabShortcut(event, ['one', 'two'], 'one', (id) => active.push(id), true);
  handleSessionTabShortcut(
    { ...event, ctrlKey: false },
    ['one', 'two'],
    'one',
    (id) => active.push(id),
    false,
  );
  assert.deepEqual(active, ['two']);
  assert.equal(prevented, 1);
});
