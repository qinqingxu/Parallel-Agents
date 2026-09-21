import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, normalize } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createProjectWorktree } from '../src/main/worktrees.ts';

const execFileAsync = promisify(execFile);

async function git(path, ...args) {
  const { stdout } = await execFileAsync('git', ['-C', path, ...args]);
  return stdout.trim();
}

async function fixture(t, committed = true) {
  const root = await mkdtemp(join(process.cwd(), '.worktrees-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const basePath = join(root, 'base repo');
  await mkdir(basePath);
  await git(basePath, 'init', '-b', 'main');
  await git(basePath, 'config', 'user.name', 'Worktree Test');
  await git(basePath, 'config', 'user.email', 'worktree-test@example.invalid');
  await git(basePath, 'config', 'commit.gpgSign', 'false');
  await git(basePath, 'config', 'core.autocrlf', 'false');
  await git(basePath, 'config', 'core.hooksPath', join(root, 'no-hooks'));
  if (committed) {
    await writeFile(join(basePath, 'tracked.txt'), 'committed\n');
    await git(basePath, 'add', 'tracked.txt');
    await git(basePath, 'commit', '-m', 'Initial commit');
  }
  return {
    root,
    basePath,
    branch: 'feature/new-work',
    startPoint: '',
    targetPath: join(root, 'base repo.worktrees', 'new work'),
  };
}

async function assertUnchangedAfterFailure(options, pattern) {
  const before = await git(options.basePath, 'for-each-ref', '--format=%(refname) %(objectname)');
  await assert.rejects(createProjectWorktree(options), pattern);
  assert.equal(
    await git(options.basePath, 'for-each-ref', '--format=%(refname) %(objectname)'),
    before,
  );
}

test('creates a sibling worktree with spaces, defaults to HEAD, and leaves dirty base unchanged', async (t) => {
  const options = await fixture(t);
  const head = await git(options.basePath, 'rev-parse', 'HEAD');
  await writeFile(join(options.basePath, 'tracked.txt'), 'staged\n');
  await git(options.basePath, 'add', 'tracked.txt');
  await writeFile(join(options.basePath, 'tracked.txt'), 'unstaged\n');
  await writeFile(join(options.basePath, 'untracked.txt'), 'untracked\n');
  const status = await git(options.basePath, 'status', '--porcelain=v1');
  const staged = await git(options.basePath, 'diff', '--cached');
  const unstaged = await git(options.basePath, 'diff');

  const actualPath = await createProjectWorktree(options);

  assert.equal(actualPath, normalize(await realpath(options.targetPath)));
  assert.equal(await git(actualPath, 'branch', '--show-current'), options.branch);
  assert.equal(await git(actualPath, 'rev-parse', 'HEAD'), head);
  assert.equal(await readFile(join(actualPath, 'tracked.txt'), 'utf8'), 'committed\n');
  assert.equal(await git(actualPath, 'status', '--porcelain=v1'), '');
  assert.equal(await git(options.basePath, 'branch', '--show-current'), 'main');
  assert.equal(await git(options.basePath, 'rev-parse', 'HEAD'), head);
  assert.equal(await git(options.basePath, 'status', '--porcelain=v1'), status);
  assert.equal(await git(options.basePath, 'diff', '--cached'), staged);
  assert.equal(await git(options.basePath, 'diff'), unstaged);
  assert.equal(await readFile(join(options.basePath, 'untracked.txt'), 'utf8'), 'untracked\n');
});

test('uses the exact requested commit ref rather than the current HEAD', async (t) => {
  const options = await fixture(t);
  const first = await git(options.basePath, 'rev-parse', 'HEAD');
  await git(options.basePath, 'tag', 'old-start');
  await writeFile(join(options.basePath, 'tracked.txt'), 'new commit\n');
  await git(options.basePath, 'commit', '-am', 'Second commit');
  const current = await git(options.basePath, 'rev-parse', 'HEAD');

  const actualPath = await createProjectWorktree({ ...options, startPoint: 'refs/tags/old-start' });

  assert.equal(await git(actualPath, 'rev-parse', 'HEAD'), first);
  assert.equal(await git(options.basePath, 'rev-parse', 'HEAD'), current);
});

test('rejects invalid and option-like start refs without creating branches or directories', async (t) => {
  const options = await fixture(t);
  const blob = await git(options.basePath, 'rev-parse', 'HEAD:tracked.txt');
  for (const startPoint of ['missing-ref', '--help', 'HEAD --detach', blob]) {
    await assertUnchangedAfterFailure({ ...options, startPoint }, /start point/i);
    await assert.rejects(lstat(options.targetPath), { code: 'ENOENT' });
  }
});

test('rejects invalid branches, flags and previous-branch syntax without changing refs', async (t) => {
  const options = await fixture(t);
  await git(options.basePath, 'checkout', '-b', 'previous');
  await git(options.basePath, 'checkout', 'main');
  for (const branch of ['', 'bad branch', 'bad..branch', '-new', '@{-1}']) {
    await assertUnchangedAfterFailure({ ...options, branch }, /branch/i);
    await assert.rejects(lstat(options.targetPath), { code: 'ENOENT' });
  }
});

test('rejects existing targets without altering their contents or refs', async (t) => {
  const options = await fixture(t);
  await mkdir(options.targetPath, { recursive: true });
  await writeFile(join(options.targetPath, 'keep.txt'), 'keep me');
  await assertUnchangedAfterFailure(options, /already exists/i);
  assert.equal(await readFile(join(options.targetPath, 'keep.txt'), 'utf8'), 'keep me');
  const emptyPath = join(options.root, 'empty');
  await mkdir(emptyPath);
  await assertUnchangedAfterFailure({ ...options, targetPath: emptyPath }, /already exists/i);
  const filePath = join(options.root, 'existing-file');
  await writeFile(filePath, 'untouched');
  await assertUnchangedAfterFailure({ ...options, targetPath: filePath }, /already exists/i);
  assert.equal(await readFile(filePath, 'utf8'), 'untouched');
});

test('rejects relative paths and paths inside the entire base working tree', async (t) => {
  const options = await fixture(t);
  await assert.rejects(createProjectWorktree({ ...options, basePath: 'relative' }), /absolute/i);
  await assertUnchangedAfterFailure({ ...options, targetPath: 'relative' }, /absolute/i);
  const subdirectory = join(options.basePath, 'subdir');
  await mkdir(subdirectory);
  await assertUnchangedAfterFailure(
    {
      ...options,
      basePath: subdirectory,
      targetPath: join(options.basePath, 'elsewhere', 'worktree'),
    },
    /inside.*working tree/i,
  );
});

test('rejects a target reached through a symlink into the base working tree', async (t) => {
  const options = await fixture(t);
  const alias = join(options.root, 'alias');
  await symlink(options.basePath, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assertUnchangedAfterFailure(
    {
      ...options,
      targetPath: join(alias, 'nested', 'worktree'),
    },
    /inside.*working tree/i,
  );
});

test('returns the physical normalized path when the target parent is a directory alias', async (t) => {
  const options = await fixture(t);
  const destination = join(options.root, 'destination');
  await mkdir(destination);
  const alias = join(options.root, 'alias');
  await symlink(destination, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await createProjectWorktree({
    ...options,
    targetPath: join(alias, 'new work'),
  });
  assert.equal(result, join(await realpath(destination), 'new work'));
  assert.equal(await git(result, 'branch', '--show-current'), options.branch);
});

test('rejects non-directory target ancestors before creating a branch', async (t) => {
  const options = await fixture(t);
  const filePath = join(options.root, 'file');
  await writeFile(filePath, 'keep me');
  await assertUnchangedAfterFailure(
    {
      ...options,
      targetPath: join(filePath, 'worktree'),
    },
    /directory|ENOTDIR/i,
  );
  assert.equal(await readFile(filePath, 'utf8'), 'keep me');
});

test('rejects non-repositories, missing directories and repositories without HEAD', async (t) => {
  const options = await fixture(t, false);
  const nonGit = join(options.root, 'non-git');
  await mkdir(nonGit);
  // Stop Git's upward discovery at the fixture, which lives in the project checkout.
  await writeFile(join(nonGit, '.git'), 'gitdir: nonexistent-git-directory\n');
  await assert.rejects(createProjectWorktree({ ...options, basePath: nonGit }), /repository|git/i);
  await assert.rejects(
    createProjectWorktree({
      ...options,
      basePath: join(options.root, 'missing'),
    }),
    /base.*directory/i,
  );
  await assertUnchangedAfterFailure(options, /HEAD.*commit/i);
  await assert.rejects(lstat(options.targetPath), { code: 'ENOENT' });
});

test('Git rejects duplicate branch names and its stderr remains visible', async (t) => {
  const options = await fixture(t);
  await git(options.basePath, 'branch', options.branch);
  await assertUnchangedAfterFailure(options, /already exists/i);
  await assert.rejects(lstat(options.targetPath), { code: 'ENOENT' });
});
