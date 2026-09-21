import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import filesystem, {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HELP, parseArgs, verifyMaintenanceLoop } from '../scripts/verify-maintenance-loop.mjs';
import { createCommands } from '../scripts/maintenance-loop/commands.mjs';
import {
  assertDriverReceipt,
  assertSnapshotDelta,
  isolatedEnvironment,
  LOOP_LIMITS,
  requireCandidateScripts,
} from '../scripts/maintenance-loop/contract.mjs';
import * as loopContract from '../scripts/maintenance-loop/contract.mjs';
import {
  captureCandidate,
  copyCandidate,
  createRunDirectory,
  removeScratch,
  writeNew,
} from '../scripts/maintenance-loop/fixture.mjs';
import { runOwnedProcess } from '../scripts/maintenance/process.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function put(root, path, content) {
  const target = join(root, ...path.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function fixture(t) {
  const reports = join(repository, 'reports');
  await mkdir(reports, { recursive: true });
  const root = await mkdtemp(join(reports, 'maintenance-loop-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'reports', 'home');
  await mkdir(home, { recursive: true });
  const commands = createCommands({ env: isolatedEnvironment(home) });
  await put(root, '.gitignore', 'reports/\nnode_modules/\n.env*\nignored/\n');
  await put(root, '.gitattributes', 'docs/generated.md generated\n');
  await put(root, 'README.md', '# Fixture\n');
  await put(root, 'src/product.js', 'export const product = 1;\n');
  await put(root, 'resources/product.bin', Buffer.from([0, 255, 1]));
  await put(root, 'package.json', '{"name":"fixture"}\n');
  await commands.git(root, ['init', '--quiet', '--template='], 'fixture-init');
  await commands.git(root, ['add', '--all'], 'fixture-add');
  await commands.git(root, ['commit', '--quiet', '-m', 'Disposable baseline'], 'fixture-commit');
  return { root, home, commands };
}

test('CLI exposes only the fixed local loop and help, never arbitrary commands or mutation flags', () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(['--help']), { help: true });
  for (const args of [
    ['--apply'],
    ['--root', 'elsewhere'],
    ['--output', '..\\receipt.json'],
    ['--timeout', '900000'],
    ['--help', '--help'],
    ['--help', '--apply'],
  ]) {
    assert.throws(() => parseArgs(args), /argument/i);
  }
  assert.match(HELP, /local.fixture/i);
  assert.match(HELP, /180/);
  assert.match(HELP, /no.*install/i);
  assert.ok(LOOP_LIMITS.totalTimeoutMs + 3_000 < 600_000);
});

test('child environment drops inherited Git/Node injection and provider data locations', () => {
  const home = join(repository, 'reports', 'example-home');
  const env = isolatedEnvironment(home, {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: 'live-home',
    USERPROFILE: 'live-home',
    APPDATA: 'live-appdata',
    XDG_CONFIG_HOME: 'live-config',
    GIT_INDEX_FILE: 'caller.index',
    GIT_DIR: 'caller.git',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: 'caller',
    NODE_OPTIONS: '--require injected.js',
    NODE_PATH: 'injected-modules',
    NPM_TOKEN: 'fixture-token',
    OPENAI_API_KEY: 'fixture-key',
    npm_config_script_shell: 'injected-shell',
  });
  for (const name of [
    'GIT_INDEX_FILE',
    'GIT_DIR',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_KEY_0',
    'GIT_CONFIG_VALUE_0',
    'NODE_OPTIONS',
    'NODE_PATH',
    'NPM_TOKEN',
    'OPENAI_API_KEY',
    'npm_config_script_shell',
  ]) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.ok(env.APPDATA.startsWith(home));
  assert.ok(env.XDG_CONFIG_HOME.startsWith(home));
  assert.ok(env.TEMP.startsWith(home));
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.npm_config_offline, 'true');
});

test('full-loop supervision refuses platforms without the required Windows PID-tree termination', () => {
  assert.equal(typeof loopContract.requireVerifierPlatform, 'function');
  loopContract.requireVerifierPlatform('win32');
  for (const platform of ['linux', 'darwin']) {
    assert.throws(() => loopContract.requireVerifierPlatform(platform), {
      code: 'unsupported-platform',
    });
  }
});

test('candidate contract refuses recursive E2E, lifecycle hooks, and replacement validation', async () => {
  const manifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
  const expectedTest =
    'node --test --test-concurrency=4 --import ./tests/helpers/isolated-git.mjs --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/*.test.mjs';
  assert.equal(manifest.scripts.test, expectedTest);
  requireCandidateScripts(manifest);
  for (const [key, value] of [
    ['test', expectedTest.replace(' --test-concurrency=4', '')],
    ['check', 'npm run test:maintenance-loop'],
    ['test', 'node --test tests/e2e/*.mjs'],
    ['precheck', 'node injected.mjs'],
    ['posttest', 'npm install'],
    ['check:docs', 'node -e "process.exit(0)"'],
    ['check:docs', 'node scripts/check-docs.mjs'],
    ['check:agent-corpus', 'node -e "process.exit(0)"'],
    ['test', expectedTest.replace('--test-concurrency=4', '--test-concurrency=0')],
    ['test', expectedTest.replace('--test-concurrency=4', '--test-concurrency=16')],
    ['test', expectedTest.replace('--test-concurrency=4', '--test-concurrency 4')],
    ['test', expectedTest.replace('node --test ', 'node --test --test-name-pattern=fast ')],
    ['test', `${expectedTest} --test-reporter=spec`],
    ['test', expectedTest.replace(' --import ./tests/helpers/isolated-git.mjs', '')],
    ['test', expectedTest.replace('tests/*.test.mjs', 'tests/e2e/*.mjs')],
  ]) {
    const changed = structuredClone(manifest);
    changed.scripts[key] = value;
    assert.throws(() => requireCandidateScripts(changed), { code: 'unsupported-check-contract' });
  }
});

test('snapshot copies dirty and untracked current bytes, not HEAD, while excluding private/generated data', async (t) => {
  const { root, commands } = await fixture(t);
  await put(root, 'README.md', '# Current dirty candidate\n');
  await put(root, 'docs/untracked.md', '# Current untracked candidate\n');
  await put(root, '.env.local', 'excluded environment data');
  await put(root, '.npmrc', 'excluded npm data');
  await put(root, '.copilot/session-state/private.json', 'excluded provider data');
  await put(root, 'docs/generated.md', 'excluded generated data');
  await put(root, 'docs/superpowers/past.md', Buffer.alloc(2048, 255));
  await put(root, 'ignored/private.txt', 'excluded ignored data');
  const before = await captureCandidate(root, commands);
  const destination = join(root, 'reports', 'copy');
  await mkdir(destination);
  await copyCandidate(before, destination);
  assert.equal(
    await readFile(join(destination, 'README.md'), 'utf8'),
    '# Current dirty candidate\n',
  );
  assert.equal(
    await readFile(join(destination, 'docs', 'untracked.md'), 'utf8'),
    '# Current untracked candidate\n',
  );
  assert.deepEqual(
    await readFile(join(destination, 'resources', 'product.bin')),
    Buffer.from([0, 255, 1]),
  );
  for (const path of [
    '.env.local',
    '.npmrc',
    '.copilot/session-state/private.json',
    'docs/generated.md',
  ]) {
    await assert.rejects(readFile(join(destination, ...path.split('/'))), { code: 'ENOENT' });
  }
  assert.equal((await readFile(join(destination, 'docs', 'superpowers', 'past.md'))).length, 0);
  assert.deepEqual(before.historyPaths, ['docs/superpowers/past.md']);
  assert.ok(
    before.excluded.some(
      ({ path, reason }) => path === 'docs/generated.md' && reason === 'generated-attribute',
    ),
  );
  assert.match(before.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(before.contentSha256, (await captureCandidate(root, commands)).contentSha256);
  await put(root, 'docs/untracked.md', '# Concurrent contributor edit\n');
  const after = await captureCandidate(root, commands);
  assert.notEqual(before.contentSha256, after.contentSha256);
  assert.throws(() => assertSnapshotDelta(before, after, []), { code: 'unexpected-diff' });
  assert.equal(
    await readFile(join(root, 'docs', 'untracked.md'), 'utf8'),
    '# Concurrent contributor edit\n',
  );
});

test('snapshot refuses linked active files and linked history targets without following them', async (t) => {
  const { root, commands } = await fixture(t);
  await link(join(root, 'README.md'), join(root, 'docs-linked.md'));
  await assert.rejects(captureCandidate(root, commands), { code: 'unsafe-path' });
  await rm(join(root, 'docs-linked.md'));
  const external = join(root, 'reports', 'external');
  await mkdir(external);
  await mkdir(join(root, 'docs'));
  await symlink(
    external,
    join(root, 'docs', 'superpowers'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await put(root, 'reports/external/target.md', '# Not fixture-owned history\n');
  await commands.git(
    root,
    ['add', '--intent-to-add', '--', 'docs/superpowers'],
    'fixture-link-index',
  );
  await assert.rejects(captureCandidate(root, commands), { code: 'unsafe-path' });
});

test('snapshot preserves tracked deletions and never invents absent historical reference targets', async (t) => {
  const { root, commands } = await fixture(t);
  await put(root, 'docs/superpowers/deleted.md', '# Historical\n');
  await commands.git(root, ['add', '--all'], 'fixture-history-add');
  await commands.git(
    root,
    ['commit', '--quiet', '-m', 'Disposable history path'],
    'fixture-history-commit',
  );
  await rm(join(root, 'docs', 'superpowers', 'deleted.md'));
  await rm(join(root, 'README.md'));
  const snapshot = await captureCandidate(root, commands);
  assert.deepEqual(snapshot.missingPaths, ['README.md', 'docs/superpowers/deleted.md']);
  assert.deepEqual(snapshot.historyPaths, []);
  const destination = join(root, 'reports', 'copy');
  await mkdir(destination);
  await copyCandidate(snapshot, destination);
  await assert.rejects(readFile(join(destination, 'docs', 'superpowers', 'deleted.md')), {
    code: 'ENOENT',
  });
});

test('run allocation rejects nonignored output and report junctions before creating artifacts', async (t) => {
  const { root, commands } = await fixture(t);
  await put(root, '.gitignore', 'node_modules/\n');
  await assert.rejects(createRunDirectory(root, commands), { code: 'unsafe-output' });
  await put(root, '.gitignore', 'reports/\nnode_modules/\n');
  const external = join(root, 'reports', 'external');
  await mkdir(external);
  await symlink(
    external,
    join(root, 'reports', 'maintenance-loop'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(createRunDirectory(root, commands), { code: 'unsafe-path' });
});

async function withAllocationFault(t, root, options, action) {
  const real = Object.fromEntries(
    ['mkdir', 'mkdtemp', 'lstat', 'open', 'rm', 'rmdir', 'writeFile'].map((name) => [
      name,
      filesystem[name],
    ]),
  );
  const state = {
    report: null,
    scratch: null,
    scratchIdentity: null,
    faultInjected: false,
    removals: 0,
  };
  const mocks = [];
  const denied = () => Object.assign(new Error('Generated allocator fault'), { code: 'EACCES' });
  const install = (name, implementation) =>
    mocks.push(t.mock.method(filesystem, name, implementation));
  t.after(async () => {
    if (!state.scratch) return;
    let info;
    try {
      info = await real.lstat(state.scratch);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (info) {
      assert.equal(info.dev, state.scratchIdentity.dev);
      assert.equal(info.ino, state.scratchIdentity.ino);
      assert.equal(info.isSymbolicLink(), false);
      await real.rm(state.scratch, { recursive: true, force: false });
    }
  });
  try {
    install('mkdir', async (path, ...args) => {
      if (
        options.at === 'home' &&
        state.scratch &&
        path === join(state.scratch, 'home', 'AppData', 'Roaming')
      ) {
        await real.writeFile(
          join(state.scratch, 'home', 'tmp', 'fixture.txt'),
          'generated allocation data',
          { flag: 'wx' },
        );
        state.faultInjected = true;
        throw denied();
      }
      const result = await real.mkdir(path, ...args);
      if (dirname(path) === join(root, 'reports', 'maintenance-loop')) state.report = path;
      return result;
    });
    install('mkdtemp', async (prefix, ...args) => {
      if (!prefix.endsWith('parallel-agents-maintenance-loop-'))
        return real.mkdtemp(prefix, ...args);
      if (options.at === 'scratch') {
        state.faultInjected = true;
        throw denied();
      }
      state.scratch = await real.mkdtemp(prefix, ...args);
      const info = await real.lstat(state.scratch);
      state.scratchIdentity = { dev: info.dev, ino: info.ino };
      return state.scratch;
    });
    install('lstat', async (path, ...args) => {
      if (options.at === 'scratch-identity' && path === state.scratch) {
        state.faultInjected = true;
        throw denied();
      }
      return real.lstat(path, ...args);
    });
    install('open', async (path, ...args) => {
      if (options.at === 'owner' && state.report && path === join(state.report, 'owner.json')) {
        if (options.populateScratch) {
          await real.writeFile(join(state.scratch, 'unmarked.txt'), 'unexpected fixture data', {
            flag: 'wx',
          });
        }
        state.faultInjected = true;
        throw denied();
      }
      if (options.receiptDenied && state.report && path === join(state.report, 'receipt.json'))
        throw denied();
      return real.open(path, ...args);
    });
    for (const method of ['rm', 'rmdir']) {
      install(method, async (path, ...args) => {
        if (path === state.scratch) {
          state.removals += 1;
          if (options.cleanupDenied) throw denied();
        }
        return real[method](path, ...args);
      });
    }
    syncBuiltinESMExports();
    return await action(state);
  } finally {
    for (const mocked of mocks) mocked.mock.restore();
    syncBuiltinESMExports();
  }
}

for (const [name, options, expectedPhase, expectedCleanup] of [
  [
    'allocation home mkdir failure releases scratch and publishes failure evidence',
    { at: 'home' },
    'prepare-home',
    'removed',
  ],
  [
    'allocation cleanup failure retains owned paths without retrying removal',
    { at: 'home', cleanupDenied: true },
    'prepare-home',
    'failed',
  ],
  [
    'allocation owner-record failure removes only verified empty scratch',
    { at: 'owner' },
    'write-owner',
    'removed',
  ],
  [
    'allocation owner-record failure preserves unexpected scratch contents',
    { at: 'owner', populateScratch: true },
    'write-owner',
    'failed',
  ],
  [
    'allocation scratch creation failure retains its report directory',
    { at: 'scratch' },
    'allocate-scratch',
    'not-created',
  ],
  [
    'allocation identity failure retains unverified scratch instead of deleting it',
    { at: 'scratch-identity' },
    'identify-scratch',
    'failed',
  ],
]) {
  test(name, { skip: process.platform !== 'win32' }, async (t) => {
    const { root } = await fixture(t);
    const beforeIndex = await readFile(join(root, '.git', 'index'));
    await withAllocationFault(t, root, options, async (state) => {
      const result = await verifyMaintenanceLoop({ root });
      assert.equal(state.faultInjected, true);
      assert.equal(result.exitCode, 1);
      assert.equal(result.receiptPath, join(state.report, 'receipt.json'));
      assert.equal(result.receipt.allocation.status, 'failed');
      assert.equal(result.receipt.allocation.phase, expectedPhase);
      assert.equal(result.receipt.allocation.cause.code, 'EACCES');
      assert.equal(result.receipt.cleanup.status, expectedCleanup);
      assert.equal(Object.hasOwn(result.receipt, 'supervision'), false);
      assert.deepEqual(JSON.parse(await readFile(result.receiptPath, 'utf8')), result.receipt);
      const retained = result.receipt.allocation.retainedPaths;
      assert.ok(
        retained.some(
          ({ path, role, state: retainedState }) =>
            path === state.report && role === 'report' && retainedState === 'present',
        ),
      );
      if (expectedCleanup === 'failed') {
        assert.ok(retained.some(({ path, role }) => path === state.scratch && role === 'scratch'));
        assert.equal(state.removals, options.cleanupDenied || options.populateScratch ? 1 : 0);
        if (options.cleanupDenied) {
          assert.equal(result.receipt.cleanup.error.code, 'EACCES');
          assert.equal(
            await readFile(join(state.scratch, 'home', 'tmp', 'fixture.txt'), 'utf8'),
            'generated allocation data',
          );
        }
        if (options.populateScratch) {
          assert.equal(result.receipt.cleanup.error.code, 'ENOTEMPTY');
          assert.equal(
            await readFile(join(state.scratch, 'unmarked.txt'), 'utf8'),
            'unexpected fixture data',
          );
        }
      } else if (state.scratch) {
        await assert.rejects(filesystem.lstat(state.scratch), { code: 'ENOENT' });
        assert.equal(
          retained.some(({ role }) => role === 'scratch'),
          false,
        );
        assert.equal(state.removals, 1);
      }
      assert.deepEqual(await readFile(join(root, '.git', 'index')), beforeIndex);
      assert.equal(await readFile(join(root, 'README.md'), 'utf8'), '# Fixture\n');
    });
  });
}

test(
  'allocation receipt-publication failure keeps the original failure and cleanup context',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { root } = await fixture(t);
    await withAllocationFault(t, root, { at: 'home', receiptDenied: true }, async (state) => {
      const result = await verifyMaintenanceLoop({ root });
      assert.equal(state.faultInjected, true);
      assert.equal(result.exitCode, 1);
      assert.equal(result.receiptPath, null);
      assert.equal(result.receipt.allocation.phase, 'prepare-home');
      assert.equal(result.receipt.allocation.cause.code, 'EACCES');
      assert.equal(result.receipt.cleanup.status, 'removed');
      assert.equal(result.receipt.reporting.status, 'failed');
      assert.equal(result.receipt.reporting.path, join(state.report, 'receipt.json'));
      assert.equal(result.receipt.reporting.error.code, 'EACCES');
      assert.ok(result.receipt.allocation.retainedPaths.some(({ path }) => path === state.report));
      await assert.rejects(filesystem.lstat(state.scratch), { code: 'ENOENT' });
    });
  },
);

test('cleanup is limited to one owned scratch directory and refuses an edited ownership marker', async (t) => {
  const { root, commands } = await fixture(t);
  const first = await createRunDirectory(root, commands);
  let firstRemoved = false;
  let second;
  try {
    second = await createRunDirectory(root, commands);
    await put(root, `${first.relativePath}/keep.json`, '{"previous":"evidence"}\n');
    await put(second.scratch, 'other.txt', 'other run');
    await removeScratch(first);
    firstRemoved = true;
    assert.equal(
      await readFile(join(first.root, 'keep.json'), 'utf8'),
      '{"previous":"evidence"}\n',
    );
    assert.equal(await readFile(join(second.scratch, 'other.txt'), 'utf8'), 'other run');
    await writeFile(join(second.root, second.owner.path), 'concurrent marker');
    await assert.rejects(removeScratch(second), { code: 'concurrent-edit' });
    assert.equal(await readFile(join(second.scratch, 'other.txt'), 'utf8'), 'other run');
  } finally {
    if (!firstRemoved) await removeScratch(first);
    if (second) {
      await writeFile(join(second.root, second.owner.path), second.owner.content);
      await removeScratch(second);
    }
  }
});

test('the isolated temporary home cannot discover the source checkout as a parent Git repository', async (t) => {
  const { root, commands } = await fixture(t);
  const run = await createRunDirectory(root, commands);
  try {
    const output = await commands.git(
      join(run.home, 'tmp'),
      ['rev-parse', '--show-toplevel'],
      'temporary-home-discovery',
      { accepted: [0, 128] },
    );
    assert.equal(
      output.toString('utf8').trim(),
      '',
      'temporary fixtures must not inherit the caller repository',
    );
    assert.equal(commands.steps.at(-1).exitCode, 128);
  } finally {
    await removeScratch(run);
  }
});

test('bounded command ledger records real nonzero exits without retaining diagnostic content', async (t) => {
  const { root, home } = await fixture(t);
  const commands = createCommands({ env: isolatedEnvironment(home), maxCommands: 1 });
  const result = await commands.run(
    'real-failure',
    process.execPath,
    [
      '-e',
      'process.stdin.on("data",data=>process.stderr.write(data));process.stdin.on("end",()=>process.exit(9))',
    ],
    {
      cwd: root,
      accepted: [9],
      input: Buffer.from('private fixture'),
    },
  );
  assert.equal(result.exitCode, 9);
  assert.equal(commands.steps[0].status, 'failed');
  assert.equal(commands.steps[0].exitCode, 9);
  assert.ok(commands.steps[0].durationMs > 0);
  assert.equal(JSON.stringify(commands.steps).includes('private fixture'), false);
  assert.equal(Object.hasOwn(commands.steps[0], 'stdout'), false);
  await assert.rejects(
    commands.run('over-budget', process.execPath, ['--version'], { cwd: root }),
    { code: 'limit-exceeded' },
  );
});

test('fixture Git operations ignore a disposable inherited caller index', async (t) => {
  const { root, home } = await fixture(t);
  const indexPath = join(root, 'reports', 'caller.index');
  const before = await readFile(join(root, '.git', 'index'));
  await writeFile(indexPath, before);
  const nested = join(root, 'reports', 'nested');
  await mkdir(nested);
  const env = isolatedEnvironment(home, {
    ...process.env,
    GIT_DIR: join(root, '.git'),
    GIT_INDEX_FILE: indexPath,
  });
  const commands = createCommands({ env });
  await commands.git(nested, ['init', '--quiet', '--template='], 'isolated-init');
  await put(nested, 'file.txt', 'nested fixture');
  await commands.git(nested, ['add', '--all'], 'isolated-add');
  await commands.git(nested, ['commit', '--quiet', '-m', 'Nested fixture'], 'isolated-commit');
  assert.deepEqual(await readFile(indexPath), before);
  assert.deepEqual(await readFile(join(root, '.git', 'index')), before);
});

function driverReceipt(phase) {
  const negative = phase === 'negative';
  const detecting = phase === 'detect';
  return {
    schemaVersion: 1,
    tool: 'non-runtime-maintenance',
    mode: detecting ? 'check' : 'apply',
    status: detecting ? 'changes-needed' : negative ? 'failed' : 'applied',
    repairPasses: detecting ? 0 : 1,
    changes: [
      {
        path: 'docs/fixture.md',
        beforeSha256: sha('before'),
        afterSha256: sha('after'),
        beforeBytes: 6,
        afterBytes: 5,
      },
    ],
    validation: detecting
      ? []
      : [
          {
            command: ['npm', 'run', 'check'],
            status: negative ? 'failed' : 'passed',
            exitCode: negative ? 1 : 0,
            durationMs: 10,
            terminationFailed: false,
          },
        ],
    protection: {
      writtenPaths: detecting ? [] : ['docs/fixture.md'],
      beforeSha256: sha('protected'),
      afterSha256: sha('protected'),
      filesBefore: 3,
      filesAfter: 3,
    },
    rollback: {
      status: negative ? 'restored' : 'not-needed',
      restoredPaths: negative ? ['docs/fixture.md'] : [],
      conflictPaths: [],
    },
    errors: negative ? [{ code: 'validation-failed' }] : [],
    limits: { validationTimeoutMs: 180_000 },
  };
}

test('receipt contract requires actual validation, exact writes, nonempty protection and owned rollback', () => {
  for (const phase of ['detect', 'positive', 'negative']) {
    const expectation = { phase, path: 'docs/fixture.md', beforeSha256: sha('before') };
    assertDriverReceipt(driverReceipt(phase), expectation);
    const invalid = [
      (receipt) => {
        receipt.schemaVersion = 99;
      },
      (receipt) => {
        receipt.changes = [];
      },
      (receipt) => {
        receipt.changes[0].path = 'src/product.js';
      },
      (receipt) => {
        receipt.protection.beforeSha256 = null;
        receipt.protection.afterSha256 = null;
      },
      (receipt) => {
        receipt.protection.afterSha256 = sha('different');
      },
      (receipt) => {
        receipt.errors.push({ code: 'concurrent-edit' });
      },
      (receipt) => {
        receipt.limits.validationTimeoutMs = 240_000;
      },
    ];
    if (phase !== 'detect') {
      invalid.push(
        (receipt) => {
          receipt.validation = [];
        },
        (receipt) => {
          receipt.validation[0].terminationFailed = true;
        },
        (receipt) => {
          receipt.validation[0].command = ['node', '-e', 'process.exit(0)'];
        },
        (receipt) => {
          receipt.validation[0].durationMs = 0;
        },
      );
    }
    if (phase === 'negative') {
      invalid.push(
        (receipt) => {
          receipt.rollback.restoredPaths = [];
        },
        (receipt) => {
          receipt.rollback.conflictPaths = ['docs/fixture.md'];
        },
        (receipt) => {
          receipt.validation[0].exitCode = 0;
        },
      );
    }
    for (const mutate of invalid) {
      const receipt = driverReceipt(phase);
      mutate(receipt);
      assert.throws(() => assertDriverReceipt(receipt, expectation), { code: 'missing-evidence' });
    }
  }
});

test('malformed or absent receipt collections fail with an explicit evidence error', () => {
  const expectation = { phase: 'positive', path: 'docs/fixture.md', beforeSha256: sha('before') };
  for (const receipt of [
    null,
    {},
    { ...driverReceipt('positive'), changes: [null] },
    { ...driverReceipt('positive'), validation: [null] },
    { ...driverReceipt('positive'), errors: [null] },
    { ...driverReceipt('positive'), errors: {} },
  ]) {
    assert.throws(() => assertDriverReceipt(receipt, expectation), { code: 'missing-evidence' });
  }
});

test('missing executable and output exhaustion are explicit process failures', async (t) => {
  const { root, home } = await fixture(t);
  const commands = createCommands({ env: isolatedEnvironment(home) });
  await assert.rejects(commands.run('missing-tool', join(root, 'absent.exe'), [], { cwd: root }), {
    code: 'command-failed',
  });
  assert.equal(commands.steps[0].status, 'spawn-error');
  assert.equal(commands.steps[0].exitCode, null);
  const result = await runOwnedProcess(
    process.execPath,
    ['-e', 'process.stdout.write("x".repeat(4096))'],
    {
      cwd: root,
      env: isolatedEnvironment(home),
      timeoutMs: 5_000,
      maxOutputBytes: 100,
    },
  );
  assert.equal(result.status, 'output-limit');
});

function progressEntries(files) {
  return Object.entries(files).map(([path, content]) => ({
    path,
    kind: 'file',
    content: Buffer.from(content),
  }));
}

const progressTools = () => import('../scripts/maintenance-loop/progress.mjs');
const progressSources = () =>
  progressEntries({
    'tests/fast.test.mjs': "import test from 'node:test';\ntest('fast static result', () => {});\n",
    'tests/slow.test.mjs':
      "import { test as check } from 'node:test';\ncheck('slow static result', () => {});\n",
  });

test('parsed progress retains source locations and stages but never raw titles or diagnostics', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const catalogue = await buildTestCatalogue(progressSources());
  const secret = 'fixture-private-diagnostic-do-not-store';
  const stdout = [
    '> parallel-agents@0.1.7 check',
    '> npm run lint && npm run format:check && npm run typecheck && npm test && npm run check:docs && npm run check:agent-corpus',
    '> parallel-agents@0.1.7 lint',
    '> parallel-agents@0.1.7 format:check',
    '> parallel-agents@0.1.7 typecheck',
    '> parallel-agents@0.1.7 test',
    '> parallel-agents@0.1.7 check:docs',
    '> parallel-agents@0.1.7 check:agent-corpus',
    '\u001b[32m\u2714 fast static result (1.25ms)\u001b[39m',
    `\u2714 ${secret} (2ms)`,
    '\u2716 slow static result (4500ms)',
    `Error: ${secret}`,
    `  at C:\\Users\\private\\${secret}.mjs:4:1`,
    '\u2716 failing tests:',
    '\u2716 slow static result (4500ms)',
    '',
  ].join('\n');
  const progress = parseCheckProgress(Buffer.from(stdout), catalogue);
  assert.equal(progress.schemaVersion, 1);
  assert.equal(progress.scope, 'captured-stdout-observations-only');
  assert.equal(progress.lastObservedStage, 'check:agent-corpus');
  assert.deepEqual(progress.observedStages, [
    'check',
    'lint',
    'format:check',
    'typecheck',
    'test',
    'check:docs',
    'check:agent-corpus',
  ]);
  assert.deepEqual(progress.counts, {
    passed: 2,
    failed: 1,
    skipped: 0,
    todo: 0,
    unmapped: 1,
    ambiguous: 0,
  });
  assert.deepEqual(progress.slowestResults[0].matches, [{ file: 'tests/slow.test.mjs', line: 2 }]);
  assert.equal(progress.slowestResults[0].durationMs, 4500);
  assert.equal(progress.files[0].observedStaticTests, 1);
  assert.equal(progress.rawOutputStored, false);
  assert.deepEqual(progress.reportedTotals, {});
  assert.match(progress.limitations.join(' '), /buffered/);
  for (const excluded of [
    secret,
    'fast static result',
    'slow static result',
    'C:\\Users\\private',
  ]) {
    assert.equal(JSON.stringify(progress).includes(excluded), false);
  }
});

test('progress catalogue parses literal declarations without executing code or scanning string fixtures', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const entries = progressEntries({
    'tests/catalogue.test.mjs': [
      "import { test as check } from 'node:test';",
      'throw new Error("never execute this source");',
      'const example = "test(\'not a declaration\', () => {})";',
      "check('escaped \\'name\\'', () => {});",
      'check(`dynamic ${name}`, () => {});',
    ].join('\n'),
    'tests/e2e/never-selected.e2e.mjs': "test('not selected', () => {});",
  });
  const catalogue = await buildTestCatalogue(entries);
  const progress = parseCheckProgress(Buffer.from("\u2714 escaped 'name' (4ms)\n"), catalogue);
  assert.equal(progress.catalogue.staticTests, 1);
  assert.equal(progress.catalogue.dynamicTests, 1);
  assert.equal(progress.catalogue.files, 1);
  assert.deepEqual(progress.recentResults[0].matches, [
    { file: 'tests/catalogue.test.mjs', line: 4 },
  ]);
});

test('TAP progress records results and numeric summaries, not diagnostic YAML or skipped reasons', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const catalogue = await buildTestCatalogue(progressSources());
  const stdout = [
    'TAP version 13',
    '# Subtest: fast static result',
    'ok 1 - fast static result',
    '  ---',
    '  duration_ms: 12.5',
    '  ...',
    '# Subtest: slow static result',
    'ok 2 - slow static result # SKIP private-skip-reason',
    '  ---',
    '  duration_ms: 0.5',
    '  ...',
    '# tests 2',
    '# pass 1',
    '# fail 0',
    '# skipped 1',
    '# duration_ms 100.5',
    '',
  ].join('\n');
  const progress = parseCheckProgress(Buffer.from(stdout), catalogue);
  assert.deepEqual(progress.formats, ['tap']);
  assert.equal(progress.counts.passed, 1);
  assert.equal(progress.counts.skipped, 1);
  assert.equal(progress.slowestResults[0].durationMs, 12.5);
  assert.deepEqual(progress.reportedTotals, {
    tests: 2,
    pass: 1,
    fail: 0,
    skipped: 1,
    durationMs: 100.5,
  });
  assert.equal(JSON.stringify(progress).includes('private-skip-reason'), false);
});

test('progress neither invents a final stage nor interprets a partial result as completed', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const catalogue = await buildTestCatalogue(progressSources());
  const progress = parseCheckProgress(
    Buffer.from(
      [
        '> parallel-agents@0.1.7 check',
        '> npm run lint && npm test && npm run check:docs',
        '\u2714 fast static result (1ms)',
        '\u2714 slow static result (2ms)',
      ].join('\n'),
    ),
    catalogue,
  );
  assert.equal(progress.lastObservedStage, 'check');
  assert.equal(progress.counts.passed, 1);
  assert.equal(progress.truncated.partialFinalLine, true);
  assert.equal(
    progress.files.find(({ path }) => path === 'tests/slow.test.mjs').unobservedStaticTests,
    1,
  );
  const empty = parseCheckProgress(Buffer.from('unrecognized private output\n'), catalogue);
  assert.equal(empty.lastObservedStage, null);
  assert.deepEqual(empty.reportedTotals, {});
  assert.deepEqual(empty.recentResults, []);
});

test('ambiguous static titles are reported as ambiguous rather than attributed to one file', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const entries = progressEntries({
    'tests/one.test.mjs': "import test from 'node:test';\ntest('shared title', () => {});",
    'tests/two.test.mjs': "import test from 'node:test';\ntest('shared title', () => {});",
  });
  const progress = parseCheckProgress(
    Buffer.from('\u2714 shared title (1ms)\n'),
    await buildTestCatalogue(entries),
  );
  assert.equal(progress.counts.ambiguous, 1);
  assert.equal(progress.recentResults[0].matches.length, 2);
  assert.ok(progress.files.every(({ observedStaticTests }) => observedStaticTests === 0));
});

test('progress distinguishes static declarations sharing one source line', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const catalogue = await buildTestCatalogue(
    progressEntries({
      'tests/inline.test.mjs':
        "import test from 'node:test'; test('one', () => {}); test('two', () => {});",
    }),
  );
  const progress = parseCheckProgress(
    Buffer.from('\u2714 one (1ms)\n\u2714 two (2ms)\n'),
    catalogue,
  );
  assert.equal(progress.files[0].staticTests, 2);
  assert.equal(progress.files[0].observedStaticTests, 2);
  assert.equal(progress.files[0].unobservedStaticTests, 0);
});

test('mixed reporter fragments cannot erase already parsed progress', async () => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const catalogue = await buildTestCatalogue(progressSources());
  const progress = parseCheckProgress(
    Buffer.from(
      [
        'ok 1 - slow static result',
        '  ---',
        '\u2714 fast static result (1ms)',
        '  duration_ms: 999',
        '  ...',
        '',
      ].join('\n'),
    ),
    catalogue,
  );
  assert.equal(progress.counts.passed, 2);
  assert.equal(progress.slowestResults[0].durationMs, 1);
});

test('progress byte, line, catalogue and retained-result limits are explicit and bounded', async () => {
  const { buildTestCatalogue, parseCheckProgress, PROGRESS_LIMITS } = await progressTools();
  const catalogue = await buildTestCatalogue(progressSources());
  const noisy = Buffer.from(
    `${'x'.repeat(PROGRESS_LIMITS.maxLineChars + 1)}\n` +
      '\u2714 fast static result (1ms)\n'.repeat(PROGRESS_LIMITS.maxLines + 5),
  );
  const progress = parseCheckProgress(noisy, catalogue);
  assert.equal(progress.truncated.lineCount, true);
  assert.equal(progress.truncated.longLines, 1);
  assert.ok(progress.recentResults.length <= PROGRESS_LIMITS.maxRecentResults);
  assert.ok(progress.slowestResults.length <= PROGRESS_LIMITS.maxSlowResults);
  assert.ok(Buffer.byteLength(JSON.stringify(progress)) <= PROGRESS_LIMITS.maxArtifactBytes);
  const flood = parseCheckProgress(Buffer.alloc(PROGRESS_LIMITS.maxStdoutBytes + 1, 10), catalogue);
  assert.equal(flood.truncated.stdoutBytes, true);
  await assert.rejects(
    buildTestCatalogue([
      {
        path: 'tests/oversized.test.mjs',
        kind: 'file',
        content: Buffer.alloc(PROGRESS_LIMITS.maxSourceFileBytes + 1, 32),
      },
    ]),
    { code: 'limit-exceeded' },
  );
});

test('real short Node timeout persists redacted parsed progress before command rejection', async (t) => {
  const { buildTestCatalogue, parseCheckProgress } = await progressTools();
  const { root, home } = await fixture(t);
  const secret = 'fixture-private-title-never-serialize';
  const entries = progressEntries({
    'tests/progress-fast.test.mjs': [
      "import test from 'node:test';",
      "test('real completed diagnostic test', () => {});",
      `const title = '${secret}';`,
      'test(title, () => {});',
    ].join('\n'),
    'tests/progress-waiting.test.mjs': [
      "import test from 'node:test';",
      "test('real waiting diagnostic test', () => new Promise(() => { setInterval(() => {}, 1000); }));",
    ].join('\n'),
  });
  for (const entry of entries) await put(root, entry.path, entry.content);
  const catalogue = await buildTestCatalogue(entries);
  const commands = createCommands({
    env: isolatedEnvironment(home),
    onStep: (step) => writeNew(root, 'progress-result.json', `${JSON.stringify(step)}\n`),
  });
  await assert.rejects(
    commands.run(
      'short-node-timeout',
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        ...entries.map(({ path }) => join(root, ...path.split('/'))),
      ],
      { cwd: root, timeoutMs: 5_000, accepted: [0, 1], progressCatalogue: catalogue },
    ),
    { code: 'command-failed' },
  );
  const savedText = await readFile(join(root, 'progress-result.json'), 'utf8');
  const saved = JSON.parse(savedText);
  assert.equal(saved.status, 'timed-out');
  assert.equal(saved.timeoutMs, 5_000);
  assert.equal(saved.terminationFailed, false);
  assert.ok(saved.progress.counts.passed >= 1);
  assert.equal(
    saved.progress.files.find(({ path }) => path === 'tests/progress-fast.test.mjs')
      .observedStaticTests,
    1,
  );
  assert.equal(
    saved.progress.files.find(({ path }) => path === 'tests/progress-waiting.test.mjs')
      .unobservedStaticTests,
    1,
  );
  assert.equal(savedText.includes(secret), false);
  assert.equal(savedText.includes('real completed diagnostic test'), false);
  assert.equal(Object.hasOwn(saved, 'stdout'), false);
  assert.deepEqual(parseCheckProgress(Buffer.alloc(0), catalogue).recentResults, []);
});

test('a diagnostic parsing error is persisted without hiding the actual child failure', async (t) => {
  const { root, home } = await fixture(t);
  const commands = createCommands({
    env: isolatedEnvironment(home),
    onStep: (step) => writeNew(root, 'failed-diagnostics.json', `${JSON.stringify(step)}\n`),
  });
  await assert.rejects(
    commands.run('diagnostic-parser-failure', process.execPath, ['-e', 'process.exit(9)'], {
      cwd: root,
      progressCatalogue: {},
    }),
    { code: 'command-failed' },
  );
  const saved = JSON.parse(await readFile(join(root, 'failed-diagnostics.json'), 'utf8'));
  assert.equal(saved.exitCode, 9);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.progressError.code, 'invalid-progress-input');
  assert.equal(Object.hasOwn(saved, 'progress'), false);
});
