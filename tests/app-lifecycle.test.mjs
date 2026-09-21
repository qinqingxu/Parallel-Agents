import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';

test('window-all-closed accepts no event argument and keeps the tray app running', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.whenReady = () => new Promise(() => {});
  app.quit = () => {
    quitCalls++;
  };
  const source = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs' });
  const require = createRequire(import.meta.url);
  new Function('require', code)((id) => {
    if (id === 'electron') return { app };
    if (id.startsWith('./')) return {};
    return require(id);
  });
  assert.equal(app.listenerCount('window-all-closed'), 1);
  assert.doesNotThrow(() => app.emit('window-all-closed'));
  assert.equal(quitCalls, 0);
});
