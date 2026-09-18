import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveNpmCli,
  runOwnedProcess,
  validationEnvironment,
} from '../scripts/maintenance/process.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));

async function fixture(t) {
  const artifacts = join(repository, 'reports');
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, 'maintenance-process-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() >= deadline) {
      assert.fail(`Process ${pid} remained visible after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('npm discovery selects a real absolute JavaScript CLI, never npm.cmd or a shell string', async () => {
  const cli = await resolveNpmCli();
  assert.ok(isAbsolute(cli));
  assert.match(cli, /[\\/]npm-cli\.js$/);
});

test('validation environment does not inherit arbitrary credentials or Node/Git injection', async () => {
  const env = validationEnvironment({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    OPENAI_API_KEY: 'must-not-pass',
    GITHUB_TOKEN: 'must-not-pass',
    NODE_OPTIONS: '--require attacker.js',
    NPM_TOKEN: 'must-not-pass',
    GIT_DIR: 'wrong-repository',
    GIT_WORK_TREE: 'wrong-worktree',
    GIT_INDEX_FILE: 'wrong-absolute-index',
    GIT_COMMON_DIR: 'wrong-git-common-dir',
    GIT_OBJECT_DIRECTORY: 'wrong-objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: 'wrong-alternate-objects',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: 'wrong-worktree',
    GIT_CONFIG_PARAMETERS: 'wrong-configuration',
    GIT_PREFIX: 'wrong-prefix',
    npm_config_script_shell: 'attacker.exe',
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.deepEqual(
    Object.keys(env).filter(
      (key) =>
        key.startsWith('GIT_') && !['GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT'].includes(key),
    ),
    [],
  );
  assert.equal(env.npm_config_script_shell, undefined);
});

test('owned subprocess reports the real failing exit and counts but does not expose output', async (t) => {
  const root = await fixture(t);
  const result = await runOwnedProcess(
    process.execPath,
    ['-e', 'console.error("sensitive fixture output"); process.exit(9)'],
    { cwd: root, timeoutMs: 5_000, maxOutputBytes: 1024 },
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 9);
  assert.ok(result.outputBytes > 0);
  assert.equal(JSON.stringify(result).includes('sensitive fixture output'), false);
});

test('subprocess timeout is bounded and terminates its own PID', async (t) => {
  const root = await fixture(t);
  const result = await runOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: root,
    timeoutMs: 150,
    maxOutputBytes: 1024,
  });
  assert.equal(result.status, 'timed-out');
  assert.ok(result.durationMs >= 100);
  assert.ok(result.durationMs < 10_000);
  assert.equal(result.terminationFailed, false);
  await waitForProcessExit(result.pid);
});

test('timeout also terminates owned descendants rather than leaving a validation process behind', async (t) => {
  const root = await fixture(t);
  const result = await runOwnedProcess(
    process.execPath,
    [
      '-e',
      'const {spawn}=require("node:child_process");' +
        'const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});' +
        'console.log(child.pid);setInterval(()=>{},1000);',
    ],
    { cwd: root, timeoutMs: 750, maxOutputBytes: 1024, capture: true },
  );
  const descendant = Number(result.stdout.toString('utf8').trim());
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
  t.after(() => {
    try {
      process.kill(descendant, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  });
  assert.equal(result.status, 'timed-out');
  assert.equal(result.terminationFailed, false);
  await waitForProcessExit(descendant);
});

test('flooding output and a missing executable fail instead of succeeding or hanging', async (t) => {
  const root = await fixture(t);
  const flood = await runOwnedProcess(
    process.execPath,
    ['-e', 'setInterval(() => process.stdout.write("x".repeat(2048)), 1)'],
    { cwd: root, timeoutMs: 5_000, maxOutputBytes: 1024 },
  );
  assert.equal(flood.status, 'output-limit');
  assert.ok(flood.outputBytes > 1024);
  assert.equal(flood.terminationFailed, false);
  const missing = await runOwnedProcess(join(root, 'missing-tool'), [], {
    cwd: root,
    timeoutMs: 500,
    maxOutputBytes: 1024,
  });
  assert.equal(missing.status, 'spawn-error');
  assert.equal(missing.exitCode, null);
});
