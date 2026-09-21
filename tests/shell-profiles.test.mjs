import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveShellLaunch } from '../src/main/shell-profiles.ts';

test('uses PowerShell Core for windows powershell profile', () => {
  const launch = resolveShellLaunch('win32', 'powershell', 'pwsh.exe');
  assert.equal(launch.command, 'pwsh.exe');
  assert.deepEqual(launch.args, []);
});

test('uses cmd for windows cmd profile', () => {
  const launch = resolveShellLaunch('win32', 'cmd', null);
  assert.equal(launch.command, 'cmd.exe');
  assert.deepEqual(launch.args, []);
});

test('uses bash profile when requested on windows', () => {
  const launch = resolveShellLaunch('win32', 'bash', null);
  assert.equal(launch.command, 'bash.exe');
  assert.deepEqual(launch.args, []);
});

test('uses login shell on non-windows default profile', () => {
  const launch = resolveShellLaunch('darwin', 'default', '/bin/zsh');
  assert.equal(launch.command, '/bin/zsh');
  assert.deepEqual(launch.args, ['-l']);
});

test('retains synchronous fallback behavior for arbitrary profile strings', () => {
  assert.deepEqual(resolveShellLaunch('win32', 'wsl:Ubuntu', null), {
    command: 'powershell.exe',
    args: [],
  });
  assert.deepEqual(resolveShellLaunch('linux', 'fish', '/bin/zsh'), {
    command: '/bin/zsh',
    args: ['-l'],
  });
});
