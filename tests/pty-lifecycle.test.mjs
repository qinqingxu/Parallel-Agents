import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function createManager(resolveShell) {
  const processes = [];
  const events = [];
  const timers = [];
  const harness = {
    resolveShell,
    send: (...args) => events.push(args),
    spawn() {
      const process = {
        writes: [],
        kill() {},
        resize() {},
        write(data) {
          this.writes.push(data);
        },
        onData(callback) {
          this.data = callback;
        },
        onExit(callback) {
          this.exit = callback;
        },
      };
      processes.push(process);
      return process;
    },
  };
  const result = await build({
    entryPoints: ['src/main/pty-manager.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'isolated-process-probes',
        setup(builder) {
          const mocks = {
            'node-pty': 'export const spawn=harness.spawn;',
            './shell-profiles.ts': 'export const resolveAvailableShell=harness.resolveShell;',
            './window-messenger.ts': 'export const sendToWindow=harness.send;',
          };
          builder.onResolve(
            { filter: /^(node-pty|\.\/shell-profiles\.ts|\.\/window-messenger\.ts)$/ },
            ({ path }) => ({ path, namespace: 'probes' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'probes' }, ({ path }) => ({
            contents: mocks[path],
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'harness', 'setTimeout', result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
    harness,
    (callback) => timers.push(callback),
  );
  return { manager: module.exports.ptyManager, processes, events, timers };
}

test('closing a tab cancels a pending discovered shell launch', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { manager, processes } = await createManager(() => pending);
  const spawning = manager.spawn('tab', 'C:\\repo', 80, 24, undefined, undefined, 'bash');
  manager.kill('tab');
  resolve({ command: 'bash', args: [] });
  await spawning;
  assert.equal(processes.length, 0);
  assert.equal(manager.has('tab'), false);
});

test('stale process output, exit and startup commands never affect its replacement', async () => {
  const { manager, processes, events, timers } = await createManager(async () => ({
    command: 'bash',
    args: [],
  }));
  await manager.spawn('tab', 'C:\\repo', 80, 24, 'old command');
  processes[0].data('old output');
  assert.equal(events.length, 1);
  manager.kill('tab');
  await manager.spawn('tab', 'C:\\repo', 80, 24, 'new command');
  processes[0].data('late output');
  processes[0].exit({ exitCode: 0 });
  timers.forEach((callback) => callback());
  assert.equal(manager.has('tab'), true);
  assert.equal(events.length, 1);
  assert.deepEqual(processes[0].writes, []);
  assert.deepEqual(processes[1].writes, ['new command\r']);
  processes[1].exit({ exitCode: 0 });
  assert.equal(manager.has('tab'), false);
  assert.equal(events.length, 2);
});

test('shell discovery failure propagates and permits a later launch', async () => {
  const { manager, processes } = await createManager(async () => {
    throw new Error('Shell unavailable');
  });
  await assert.rejects(
    manager.spawn('tab', 'C:\\repo', 80, 24, undefined, undefined, 'missing'),
    /Shell unavailable/,
  );
  await manager.spawn('tab', 'C:\\repo', 80, 24);
  assert.equal(processes.length, 1);
  assert.equal(manager.has('tab'), true);
});
