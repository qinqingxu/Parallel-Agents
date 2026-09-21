import assert from 'node:assert/strict';
import test from 'node:test';
import { win32, posix } from 'node:path';

import {
  createShellDiscovery,
  resolveAvailableShell,
  resolveShellLaunch,
} from '../src/main/shell-profiles.ts';

function fixture({
  platform = 'win32',
  env = {},
  files = [],
  shells = '',
  run,
  executableError,
} = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const normalize = (value) =>
    platform === 'win32' ? paths.normalize(value).toLowerCase() : value;
  const installed = new Set(files.map(normalize));
  const calls = [];
  const diagnostics = [];
  const discovery = createShellDiscovery({
    platform,
    env,
    isExecutable: async (file) => {
      assert.ok(paths.isAbsolute(file), `Expected absolute executable: ${file}`);
      if (executableError) throw executableError;
      return installed.has(normalize(file));
    },
    readShells: async () => shells,
    execFile: async (file, args) => {
      calls.push({ file, args });
      return run ? run(file, args) : '';
    },
    diagnostic: (message) => diagnostics.push(message),
  });
  return { ...discovery, calls, diagnostics };
}

test('discovers installed Windows shells with absolute commands, not arbitrary PATH CLIs', async () => {
  const probe = fixture({
    env: { Path: 'C:\\tools;C:\\Git\\bin', SystemRoot: 'C:\\Windows' },
    files: [
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\tools\\pwsh.exe',
      'C:\\tools\\nu.exe',
      'C:\\tools\\node.exe',
      'C:\\Git\\bin\\bash.exe',
    ],
  });
  assert.deepEqual(
    (await probe.discoverShells()).map(({ id }) => id),
    ['cmd', 'powershell', 'pwsh', 'bash', 'nu'],
  );
  assert.deepEqual(await probe.resolveAvailableShell('bash'), {
    command: 'C:\\Git\\bin\\bash.exe',
    args: ['--login', '-i'],
  });
  assert.equal(probe.calls.length, 0);
});

test('finds Git Bash and PowerShell Core outside PATH in standard installations', async () => {
  const probe = fixture({
    env: { ProgramFiles: 'D:\\Programs', 'ProgramFiles(x86)': 'D:\\Programs32' },
    files: ['D:\\Programs32\\Git\\bin\\bash.exe', 'D:\\Programs\\PowerShell\\7\\pwsh.exe'],
  });
  assert.deepEqual(
    (await probe.discoverShells()).map(({ id }) => id),
    ['pwsh', 'bash'],
  );
});

test('finds Git Bash relative to a PATH git.exe installation', async () => {
  const probe = fixture({
    env: { PATH: 'E:\\CustomGit\\cmd' },
    files: ['E:\\CustomGit\\cmd\\git.exe', 'E:\\CustomGit\\bin\\bash.exe'],
  });
  assert.equal((await probe.discoverShells())[0].command, 'E:\\CustomGit\\bin\\bash.exe');
  assert.equal(probe.calls.length, 0);
});

test('does not mistake the legacy WSL bash launcher for Git Bash', async () => {
  const probe = fixture({
    env: { PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' },
    files: ['C:\\Windows\\System32\\bash.exe'],
  });
  assert.deepEqual(await probe.discoverShells(), []);
});

test('returns one WSL entry per actual distro and launches with argument arrays', async () => {
  const probe = fixture({
    env: { SystemRoot: 'C:\\Windows' },
    files: ['C:\\Windows\\System32\\wsl.exe'],
    run: () => '\ufeffUbuntu-24.04\r\nDebian\r\nUbuntu-24.04\r\n',
  });
  assert.deepEqual(await probe.discoverShells(), [
    {
      id: 'wsl:Ubuntu-24.04',
      label: 'WSL: Ubuntu-24.04',
      command: 'C:\\Windows\\System32\\wsl.exe',
      args: ['--distribution', 'Ubuntu-24.04'],
    },
    {
      id: 'wsl:Debian',
      label: 'WSL: Debian',
      command: 'C:\\Windows\\System32\\wsl.exe',
      args: ['--distribution', 'Debian'],
    },
  ]);
  assert.deepEqual(probe.calls, [
    { file: 'C:\\Windows\\System32\\wsl.exe', args: ['--list', '--quiet'] },
  ]);
});

test('decodes UTF-16 WSL output and omits an empty distro list', async () => {
  for (const [output, ids] of [
    [Buffer.from('Ubuntu\r\n', 'utf16le'), ['wsl:Ubuntu']],
    ['', []],
  ]) {
    const probe = fixture({
      env: { PATH: 'C:\\tools' },
      files: ['C:\\tools\\wsl.exe'],
      run: () => output,
    });
    assert.deepEqual(
      (await probe.discoverShells()).map(({ id }) => id),
      ids,
    );
  }
});

test('preserves spaces in WSL distro names as a single argument', async () => {
  const probe = fixture({
    env: { PATH: 'C:\\tools' },
    files: ['C:\\tools\\wsl.exe'],
    run: () => 'My Ubuntu\r\n',
  });
  assert.deepEqual(await probe.resolveAvailableShell('wsl:My Ubuntu'), {
    command: 'C:\\tools\\wsl.exe',
    args: ['--distribution', 'My Ubuntu'],
  });
});

test('handles unavailable WSL diagnostically but surfaces unexpected failures and timeouts', async () => {
  const base = { env: { PATH: 'C:\\tools' }, files: ['C:\\tools\\wsl.exe'] };
  const unavailable = fixture({
    ...base,
    run: () => {
      throw Object.assign(new Error('not installed'), {
        code: 1,
        stdout: 'Error code: Wsl/WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED',
      });
    },
  });
  assert.deepEqual(await unavailable.discoverShells(), []);
  assert.equal(unavailable.diagnostics.length, 1);
  for (const error of [
    Object.assign(new Error('unexpected WSL failure'), { code: 2 }),
    Object.assign(new Error('WSL timed out'), { killed: true, code: null }),
  ]) {
    await assert.rejects(
      fixture({
        ...base,
        run: () => {
          throw error;
        },
      }).discoverShells(),
      error,
    );
  }
});

test('missing executables are acceptable, other probe errors propagate', async () => {
  const missing = fixture({
    env: { PATH: 'C:\\tools' },
    files: ['C:\\tools\\wsl.exe'],
    run: () => {
      throw Object.assign(new Error('disappeared'), { code: 'ENOENT' });
    },
  });
  assert.deepEqual(await missing.discoverShells(), []);
  const error = Object.assign(new Error('I/O failure'), { code: 'EIO' });
  await assert.rejects(fixture({ executableError: error }).discoverShells(), error);
});

test('Unix discovery merges /etc/shells, PATH candidates and SHELL without login blockers or CLIs', async () => {
  const probe = fixture({
    platform: 'linux',
    env: { PATH: '/usr/bin:/opt/bin', SHELL: '/opt/custom/fish' },
    shells: '# Login shells\n/bin/bash\n/bin/bash\n/usr/sbin/nologin\n/bin/false\n/not/installed\n',
    files: [
      '/bin/bash',
      '/usr/bin/zsh',
      '/usr/bin/pwsh',
      '/opt/bin/nu',
      '/opt/custom/fish',
      '/usr/sbin/nologin',
      '/bin/false',
      '/usr/bin/node',
    ],
  });
  assert.deepEqual(
    (await probe.discoverShells()).map(({ id }) => id),
    ['bash', 'zsh', 'pwsh', 'nu', 'fish'],
  );
  assert.deepEqual(await probe.resolveAvailableShell('fish'), {
    command: '/opt/custom/fish',
    args: ['-l'],
  });
  assert.deepEqual(await probe.resolveAvailableShell('pwsh'), {
    command: '/usr/bin/pwsh',
    args: [],
  });
});

test('ignores relative PATH directories and non-shell SHELL values', async () => {
  const probe = fixture({
    platform: 'linux',
    env: { PATH: '.:relative:/usr/bin', SHELL: '/usr/bin/node' },
    files: ['/usr/bin/node'],
  });
  assert.deepEqual(await probe.discoverShells(), []);
});

test('surfaces unexpected /etc/shells read errors', async () => {
  const error = Object.assign(new Error('I/O failure'), { code: 'EIO' });
  const probe = createShellDiscovery({
    platform: 'linux',
    env: {},
    readShells: async () => {
      throw error;
    },
  });
  await assert.rejects(probe.discoverShells(), error);
});

test('unknown selections fail explicitly and are never executed', async () => {
  const probe = fixture();
  await assert.rejects(
    probe.resolveAvailableShell('cmd & malicious'),
    /Shell profile "cmd & malicious" is not installed or available/,
  );
  assert.equal(probe.calls.length, 0);
});

test('default resolution bypasses discovery and preserves the platform default', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const probe = fixture({
      platform,
      env: { SHELL: '/bin/zsh' },
      executableError: new Error('must not probe'),
    });
    assert.deepEqual(
      await probe.resolveAvailableShell('default'),
      resolveShellLaunch(platform, 'default', '/bin/zsh'),
    );
  }
  assert.deepEqual(
    await resolveAvailableShell('default'),
    resolveShellLaunch(process.platform, 'default', process.env.SHELL ?? null),
  );
});
