import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { fail } from './policy.mjs';

export function validationEnvironment(source = process.env) {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
  ]);
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) => allowed.has(name.toUpperCase()) && value !== undefined,
    ),
  );
  return {
    ...env,
    CI: 'true',
    NO_COLOR: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_logs_max: '0',
  };
}

export async function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate) || basename(candidate) !== 'npm-cli.js') continue;
    try {
      const canonical = await realpath(candidate);
      if (
        /[\\/]npm[\\/]bin[\\/]npm-cli\.js$/u.test(canonical) &&
        (await lstat(canonical)).isFile()
      ) {
        return canonical;
      }
    } catch {
      // Try the next known installation location, never a shell or downloaded fallback.
    }
  }
  fail(
    'npm-unavailable',
    'Cannot locate the installed npm/bin/npm-cli.js; run through npm or install the documented toolchain.',
  );
}

async function terminateTree(child) {
  if (!child.pid) return true;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return true;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return false;
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !isAbsolute(systemRoot)) {
    child.kill('SIGKILL');
    return false;
  }
  return new Promise((resolve) => {
    const killer = spawn(
      join(systemRoot, 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore', env: validationEnvironment() },
    );
    const timer = setTimeout(() => {
      killer.kill('SIGKILL');
      child.kill('SIGKILL');
      resolve(false);
    }, 2_000);
    killer.once('error', () => {
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(false);
    });
    killer.once('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 || child.exitCode !== null || child.signalCode !== null);
    });
  });
}

export function runOwnedProcess(
  executable,
  args,
  { cwd, timeoutMs, maxOutputBytes, input, capture = false, env = validationEnvironment() },
) {
  const started = performance.now();
  return new Promise((resolve) => {
    let child;
    let reason;
    let timeout;
    let grace;
    let outputBytes = 0;
    let terminationFailed = false;
    let settled = false;
    let termination;
    const stdout = [];
    const finish = (exitCode = null, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(grace);
      resolve({
        status: reason ?? (exitCode === 0 ? 'passed' : 'failed'),
        exitCode,
        signal,
        pid: child?.pid ?? null,
        outputBytes,
        durationMs: Math.round(performance.now() - started),
        terminationFailed,
        ...(capture ? { stdout: Buffer.concat(stdout) } : {}),
      });
    };
    const stop = (status) => {
      if (reason || settled) return;
      reason = status;
      termination = terminateTree(child).then((success) => {
        terminationFailed = !success;
      });
      grace = setTimeout(() => {
        terminationFailed = true;
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        child.kill('SIGKILL');
        finish(child.exitCode, child.signalCode);
      }, 3_000);
    };
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch {
      reason = 'spawn-error';
      finish();
      return;
    }
    timeout = setTimeout(() => stop('timed-out'), timeoutMs);
    const collect = (data, isStdout) => {
      outputBytes += data.length;
      if (outputBytes > maxOutputBytes) stop('output-limit');
      else if (capture && isStdout && !reason) stdout.push(data);
    };
    child.stdout.on('data', (data) => collect(data, true));
    child.stderr.on('data', (data) => collect(data, false));
    child.once('error', () => {
      reason ??= 'spawn-error';
      finish();
    });
    child.once('close', async (code, signal) => {
      await termination;
      finish(code, signal);
    });
    if (input !== undefined) {
      child.stdin.on('error', () => stop('input-error'));
      child.stdin.end(input);
    }
  });
}

export async function runNpmCheck(root, limits) {
  const cli = await resolveNpmCli();
  const env = validationEnvironment();
  if (root.includes('parallel-agents-maintenance-loop-')) {
    env.PARALLEL_AGENTS_MAINTENANCE_LOOP = '1';
  }
  // npm run needs no credentials, user npmrc, cache logs, network install, or publication command.
  env.npm_config_userconfig = join(root, 'reports', 'maintenance', '.unused-user-npmrc');
  env.npm_config_globalconfig = join(root, 'reports', 'maintenance', '.unused-global-npmrc');
  return runOwnedProcess(process.execPath, [cli, 'run', 'check'], {
    cwd: root,
    timeoutMs: limits.validationTimeoutMs,
    maxOutputBytes: limits.maxValidationOutputBytes,
    env,
  });
}
