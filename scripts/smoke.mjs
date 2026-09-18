import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { withoutRepositoryGitEnvironment } from './git-environment.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const smokeTimeoutMs = 120_000;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--packaged')) {
  throw new Error('Usage: node scripts/smoke.mjs [--packaged]');
}
const packaged = args.includes('--packaged');

if (process.platform !== 'win32') {
  throw new Error('The native Electron smoke test currently requires Windows.');
}
const mainEntry = packaged
  ? join(root, 'release', 'win-unpacked', 'resources', 'app.asar', 'out', 'main', 'index.js')
  : join(root, 'out', 'main', 'index.js');
await access(packaged ? join(root, 'release', 'win-unpacked', 'resources', 'app.asar') : mainEntry);

const home = await mkdtemp(join(tmpdir(), 'parallel-agents-smoke-'));
const gitEnvironment = withoutRepositoryGitEnvironment(process.env);
try {
  const project = join(home, 'project');
  const reports = join(root, 'reports');
  const agentBin = join(home, 'bin');
  const provider = join(home, '.claude', 'projects', 'C--smoke-project');
  await mkdir(project);
  await mkdir(agentBin);
  await mkdir(provider, { recursive: true });
  await mkdir(reports, { recursive: true });
  for (const agent of ['claude', 'copilot', 'codex', 'gemini', 'aider']) {
    await writeFile(join(agentBin, `${agent}.cmd`), '@echo off\r\necho SMOKE_AGENT\r\n');
  }
  await writeFile(
    join(provider, 'smoke-session.jsonl'),
    JSON.stringify({
      type: 'user',
      cwd: project,
      timestamp: '2026-01-01T00:00:00Z',
      message: { content: 'Isolated smoke fixture' },
    }) + '\n',
  );
  const git = (...args) =>
    execFileAsync(
      'git',
      [
        '--no-pager',
        '-c',
        'user.name=Smoke Test',
        '-c',
        'user.email=smoke@example.invalid',
        '-c',
        'commit.gpgSign=false',
        '-C',
        project,
        ...args,
      ],
      { windowsHide: true, env: gitEnvironment },
    );
  await git('init', '--initial-branch=main');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'core.hooksPath', join(project, '.git', 'disabled-hooks'));
  await writeFile(join(project, 'notes.txt'), 'committed\n');
  await git('add', '--', 'notes.txt');
  await git('commit', '-m', 'Initial smoke fixture');
  await writeFile(join(project, 'notes.txt'), 'staged\n');
  await git('add', '--', 'notes.txt');
  await writeFile(join(project, 'notes.txt'), 'working\n');

  const env = { ...gitEnvironment, HOME: home, USERPROFILE: home };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = `${agentBin}${delimiter}${env[pathKey] ?? ''}`;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const result = await execFileAsync(
    require('electron'),
    [
      join(root, 'tests', 'e2e', 'electron.e2e.cjs'),
      home,
      project,
      reports,
      mainEntry,
      packaged ? 'packaged-smoke' : 'smoke',
    ],
    { cwd: root, env, windowsHide: true, timeout: smokeTimeoutMs, maxBuffer: 4 * 1024 * 1024 },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} catch (error) {
  if (error && typeof error === 'object') {
    if ('stdout' in error && typeof error.stdout === 'string') process.stdout.write(error.stdout);
    if ('stderr' in error && typeof error.stderr === 'string') process.stderr.write(error.stderr);
  }
  throw error;
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
