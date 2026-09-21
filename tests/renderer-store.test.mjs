import assert from 'node:assert/strict';
import test from 'node:test';

import { useAppStore } from '../src/renderer/store/app-store.ts';

function setup(t) {
  const previousWindow = globalThis.window;
  const killed = [];
  globalThis.window = {
    api: {
      config: { setLastAgent: async () => {} },
      sessions: { listForProject: async () => [] },
      pty: {
        kill: async (id) => {
          killed.push(id);
        },
      },
    },
  };
  useAppStore.setState(useAppStore.getInitialState(), true);
  t.after(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  return { killed };
}

test('closing a not-yet-mounted tab cancels its pending launch', (t) => {
  const { killed } = setup(t);
  useAppStore.setState({
    openTabs: ['closed', 'remaining'],
    activeTabId: 'closed',
    pendingInitialCommand: {
      closed: { command: 'cancelled-command', extraPath: [] },
      remaining: { command: 'remaining-command', extraPath: [] },
    },
    tabRespawnNonce: { closed: 2, remaining: 3 },
  });

  useAppStore.getState().closeTab('closed');

  const state = useAppStore.getState();
  assert.deepEqual(state.openTabs, ['remaining']);
  assert.equal(state.activeTabId, 'remaining');
  assert.equal(state.pendingInitialCommand.closed, undefined);
  assert.equal(state.tabRespawnNonce.closed, undefined);
  assert.equal(state.pendingInitialCommand.remaining.command, 'remaining-command');
  assert.deepEqual(killed, ['closed::agent']);
});

test('concurrent tab launches retain both tabs after asynchronous configuration writes', async (t) => {
  setup(t);
  const gate = Promise.withResolvers();
  globalThis.window.api.config.setLastAgent = () => gate.promise;

  const first = useAppStore.getState().openTabWithAgent('first', 'claude', 'claude');
  const second = useAppStore.getState().openTabWithAgent('second', 'copilot', 'copilot');
  gate.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(useAppStore.getState().openTabs, ['first', 'second']);
  assert.equal(useAppStore.getState().pendingInitialCommand.first.command, 'claude');
  assert.equal(useAppStore.getState().pendingInitialCommand.second.command, 'copilot');
});

test('a pending launch is consumed exactly once when the terminal mounts', (t) => {
  setup(t);
  const pending = { command: 'copilot --continue', extraPath: ['C:\\tools'] };
  useAppStore.setState({ pendingInitialCommand: { tab: pending } });

  assert.deepEqual(useAppStore.getState().consumePendingCommand('tab'), pending);
  assert.equal(useAppStore.getState().consumePendingCommand('tab'), undefined);
});
