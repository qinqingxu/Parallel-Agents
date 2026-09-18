import './helpers/isolated-git.mjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';

import { captureCandidate, sealEvidence, verifyEvidence } from '../scripts/evidence/provenance.mjs';

const execFileAsync = promisify(execFile);
const reporter = fileURLToPath(new URL('../scripts/ci-report.mjs', import.meta.url));

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'parallel-agents-evidence-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileAsync(
      'git',
      [
        '-c',
        'core.autocrlf=false',
        '-c',
        'commit.gpgSign=false',
        '-c',
        `core.hooksPath=${join(root, 'disabled-hooks')}`,
        '-c',
        'user.name=Evidence Test',
        '-c',
        'user.email=test@example.invalid',
        '-C',
        root,
        ...args,
      ],
      { windowsHide: true },
    );
  await git('init', '--initial-branch=main');
  await writeFile(join(root, '.gitignore'), 'reports/\n.env\nnode_modules/\n');
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'app.ts'), 'export const unchanged = true;\n');
  await git('add', '.');
  await git('commit', '-m', 'Fixture');
  return { root, git };
}

test('candidate fingerprints identify current checked content without reading ignored user data', async (t) => {
  const { root } = await fixture(t);
  await writeFile(join(root, '.env'), 'secret data must not enter a receipt');
  const first = await captureCandidate(root);
  assert.match(first.commit, /^[a-f0-9]{40,64}$/);
  assert.match(first.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.dirty, false);
  assert.ok(!first.paths.includes('.env'));
  await mkdir(join(root, 'reports'));
  await writeFile(join(root, 'reports', 'unrelated.json'), '{"private":true}');
  assert.equal((await captureCandidate(root)).contentSha256, first.contentSha256);
  await writeFile(join(root, 'new.test.mjs'), 'export {};\n');
  const second = await captureCandidate(root);
  assert.notEqual(second.contentSha256, first.contentSha256);
  assert.equal(second.dirty, true);
});

test('changing a source file invalidates evidence even without a new commit', async (t) => {
  const { root } = await fixture(t);
  const before = await captureCandidate(root);
  await writeFile(join(root, 'src', 'app.ts'), 'export const unchanged = false;\n');
  const after = await captureCandidate(root);
  assert.equal(after.commit, before.commit);
  assert.notEqual(after.contentSha256, before.contentSha256);
});

test('a receipt links immutable report bytes to the exact source fingerprint', async (t) => {
  const { root } = await fixture(t);
  const source = await captureCandidate(root);
  await mkdir(join(root, 'reports', 'validation', 'run-1'), { recursive: true });
  await writeFile(
    join(root, 'reports', 'validation', 'run-1', 'report.json'),
    '{"status":"success"}\n',
  );
  const evidence = await sealEvidence(root, {
    source,
    origin: 'workflow-step-outcomes',
    artifacts: ['reports/validation/run-1/report.json'],
    output: 'reports/validation/run-1/evidence.json',
  });
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.artifacts.length, 1);
  const verified = await verifyEvidence(root, 'reports/validation/run-1/evidence.json');
  assert.equal(verified.sourceMatches, true);
  assert.equal(verified.artifactsMatch, true);
  assert.equal(verified.independentExecutionProof, false);
});

test('modified artifacts and stale source are explicit failures rather than green summaries', async (t) => {
  const { root } = await fixture(t);
  const source = await captureCandidate(root);
  await mkdir(join(root, 'reports', 'validation', 'run-1'), { recursive: true });
  const artifact = 'reports/validation/run-1/report.json';
  const output = 'reports/validation/run-1/evidence.json';
  await writeFile(join(root, ...artifact.split('/')), '{"status":"failure"}\n');
  await sealEvidence(root, {
    source,
    origin: 'workflow-step-outcomes',
    artifacts: [artifact],
    output,
  });
  await writeFile(join(root, ...artifact.split('/')), '{"status":"success"}\n');
  await assert.rejects(verifyEvidence(root, output), /artifact.*match/i);
  await writeFile(join(root, ...artifact.split('/')), '{"status":"failure"}\n');
  await writeFile(join(root, 'src', 'app.ts'), 'changed');
  await assert.rejects(verifyEvidence(root, output), /source.*match/i);
});

test('evidence paths, links, overwrite attempts, and arbitrary JSON cannot bypass containment', async (t) => {
  const { root } = await fixture(t);
  const source = await captureCandidate(root);
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'parallel-agents-evidence-outside-')),
  );
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, 'reports'));
  await symlink(
    outside,
    join(root, 'reports', 'validation'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    sealEvidence(root, {
      source,
      origin: 'workflow-step-outcomes',
      artifacts: [],
      output: 'reports/validation/escape/evidence.json',
    }),
  );
  await assert.rejects(verifyEvidence(root, '../outside/evidence.json'));
  await assert.rejects(verifyEvidence(root, 'package.json'));
  assert.equal(
    await readFile(join(root, 'package.json'), 'utf8'),
    '{"name":"fixture","version":"1.0.0"}\n',
  );
});

test('provenance does not follow a supplied root junction to another checkout', async (t) => {
  const { root } = await fixture(t);
  const wrapper = await realpath(await mkdtemp(join(tmpdir(), 'parallel-agents-root-alias-')));
  t.after(() => rm(wrapper, { recursive: true, force: true }));
  const alias = join(wrapper, 'checkout');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(captureCandidate(alias), /link|junction/i);
});

test('sealing refuses changed content after a validation checkpoint and preserves previous receipts', async (t) => {
  const { root } = await fixture(t);
  const source = await captureCandidate(root);
  await mkdir(join(root, 'reports', 'validation', 'run'), { recursive: true });
  const artifact = 'reports/validation/run/report.json';
  const output = 'reports/validation/run/evidence.json';
  await writeFile(join(root, ...artifact.split('/')), '{}\n');
  const options = { source, origin: 'workflow-step-outcomes', artifacts: [artifact], output };
  await sealEvidence(root, options);
  const first = await readFile(join(root, ...output.split('/')), 'utf8');
  await assert.rejects(sealEvidence(root, options), /exist/i);
  assert.equal(await readFile(join(root, ...output.split('/')), 'utf8'), first);
  await writeFile(join(root, 'src', 'app.ts'), 'changed after validation');
  await assert.rejects(
    sealEvidence(root, { ...options, output: 'reports/validation/run/second-evidence.json' }),
    /source.*match/i,
  );
});

test('workflow report provenance requires an unchanged committed checkout', async (t) => {
  const { root } = await fixture(t);
  const checks = Object.fromEntries(
    [
      'install',
      'lint',
      'format',
      'typecheck',
      'tests',
      'docs',
      'agent-corpus',
      'build',
      'native',
      'audit',
    ].map((name) => [name, 'success']),
  );
  const env = {
    ...process.env,
    CI_PLATFORM: 'Windows',
    CI_STEPS_JSON: JSON.stringify(checks),
    GITHUB_ACTIONS: 'false',
  };
  const run = () =>
    execFileAsync(process.execPath, [reporter, '--with-provenance'], { cwd: root, env });
  const result = await run();
  assert.match(result.stdout, /evidence\.json/);
  await writeFile(join(root, 'src', 'app.ts'), 'mutated during checks');
  await assert.rejects(run(), /unchanged committed/i);
});

test('invalid envelope metadata and falsified path inventories are not treated as valid provenance', async (t) => {
  const { root } = await fixture(t);
  const source = await captureCandidate(root);
  const artifact = 'reports/validation/run/report.json';
  const output = 'reports/validation/run/evidence.json';
  await mkdir(join(root, 'reports', 'validation', 'run'), { recursive: true });
  await writeFile(join(root, ...artifact.split('/')), '{}');
  const valid = await sealEvidence(root, {
    source,
    origin: 'workflow-step-outcomes',
    artifacts: [artifact],
    output,
  });
  for (const change of [
    (value) => {
      delete value.source.scope;
    },
    (value) => {
      value.source.paths = ['different-source.ts'];
    },
    (value) => {
      value.generatedAt = 'not-a-timestamp';
    },
    (value) => {
      value.extra = 'unversioned claim';
    },
    (value) => {
      value.artifacts.push(value.artifacts[0]);
    },
  ]) {
    const candidate = structuredClone(valid);
    change(candidate);
    await writeFile(join(root, ...output.split('/')), JSON.stringify(candidate));
    await assert.rejects(
      verifyEvidence(root, output),
      /invalid|unsupported|source.*match|duplicate/i,
    );
  }
});
