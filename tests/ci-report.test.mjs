import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  appendGitHubSummary,
  prepareReportDirectory,
  prepareReports,
  summarizeResults,
  writeReport,
} from '../scripts/ci-report.mjs';

const execFileAsync = promisify(execFile);
const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ci-report.mjs');
const checkNames = [
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
];

function results(overrides = {}) {
  return { ...Object.fromEntries(checkNames.map((name) => [name, 'success'])), ...overrides };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-ci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Windows success requires every real check including native validation', () => {
  const report = summarizeResults('Windows', results());
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.status, 'success');
  assert.equal(report.platform, 'Windows');
  assert.equal(report.checks.length, checkNames.length);
  assert.deepEqual(report.guidance, []);
});

test('Linux explicitly records the unsupported native check as skipped', () => {
  const report = summarizeResults('Linux', results({ native: 'skipped' }));
  assert.equal(report.status, 'success');
  assert.equal(report.checks.find((check) => check.name === 'native').required, false);
  assert.throws(() => summarizeResults('Linux', results()), /native.*skipped/i);
});

test('failures and missing execution cannot become a success-shaped report', () => {
  assert.equal(summarizeResults('Windows', results({ tests: 'failure' })).status, 'failure');
  assert.equal(summarizeResults('Windows', results({ build: 'cancelled' })).status, 'cancelled');
  assert.equal(summarizeResults('Windows', results({ native: 'skipped' })).status, 'incomplete');
  const report = summarizeResults('Windows', results({ docs: 'failure' }));
  assert.match(report.guidance.join('\n'), /npm run check:docs/);
});

test('unknown platforms, missing checks and invented outcomes are rejected', () => {
  assert.throws(() => summarizeResults('macOS', results()), /platform/i);
  assert.throws(() => summarizeResults('Windows', { lint: 'success' }), /missing/i);
  assert.throws(() => summarizeResults('Windows', results({ tests: 'probably fine' })), /outcome/i);
  assert.throws(() => summarizeResults('Windows', { ...results(), fake: 'success' }), /unknown/i);
  assert.throws(() => summarizeResults('Windows', []), /object/i);
});

test('generated receipts conform to the declared version-two property contract', async () => {
  const schema = JSON.parse(
    await readFile(
      resolve(dirname(cli), '..', 'schemas', 'validation-report.v2.schema.json'),
      'utf8',
    ),
  );
  const report = summarizeResults('Windows', results());
  assert.equal(report.schemaVersion, schema.properties.schemaVersion.const);
  assert.deepEqual(Object.keys(report).sort(), [...schema.required].sort());
  assert.ok(schema.properties.status.enum.includes(report.status));
  assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
  for (const check of report.checks) {
    assert.deepEqual(
      Object.keys(check).sort(),
      [...schema.properties.checks.items.required].sort(),
    );
    assert.ok(schema.properties.checks.items.properties.name.enum.includes(check.name));
    assert.ok(schema.properties.checks.items.properties.outcome.enum.includes(check.outcome));
  }
});

test('report preparation is idempotent and never clears existing artifacts', async (t) => {
  const root = await fixture(t);
  const reports = await prepareReports(root);
  await writeFile(join(reports, 'existing.log'), 'preserve me');
  assert.equal(await prepareReports(root), reports);
  assert.equal(await readFile(join(reports, 'existing.log'), 'utf8'), 'preserve me');
});

test('reports cannot overwrite a file or follow a directory link outside the repository', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'reports'), 'not a directory');
  await assert.rejects(prepareReports(root), /directory/i);
  await rm(join(root, 'reports'));
  const outside = await fixture(t);
  await symlink(outside, join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareReports(root), /link/i);
  assert.deepEqual(await readdir(outside), []);
});

test('each CI receipt is versioned, machine-readable and preserves prior runs', async (t) => {
  const root = await fixture(t);
  const report = summarizeResults('Windows', results());
  const first = await writeReport(root, report);
  const second = await writeReport(root, report);
  assert.notEqual(first.jsonPath, second.jsonPath);
  const stored = JSON.parse(await readFile(first.jsonPath, 'utf8'));
  assert.equal(stored.status, 'success');
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.evidenceSource, 'workflow-step-outcomes');
  assert.match(await readFile(first.markdownPath, 'utf8'), /Windows/);
});

test('nested report directories cannot redirect receipts outside the repository', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(join(root, 'reports'));
  await symlink(
    outside,
    join(root, 'reports', 'validation'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(writeReport(root, summarizeResults('Windows', results())), /link/i);
  assert.deepEqual(await readdir(outside), []);
});

test('report categories cannot add path segments or escape the report root', async (t) => {
  const root = await fixture(t);
  await assert.rejects(prepareReportDirectory(root, '../outside'), /category/i);
  await assert.rejects(prepareReportDirectory(root, 'nested/child'), /category/i);
  assert.deepEqual(await readdir(root), []);
});

test('CLI preparation works without provider accounts or installed project dependencies', async (t) => {
  const root = await fixture(t);
  await execFileAsync(process.execPath, [cli, '--prepare'], { cwd: root });
  assert.deepEqual(await readdir(root), ['reports']);
});

test('CLI records declared outcomes and fails when a required check failed', async (t) => {
  const root = await fixture(t);
  const env = {
    ...process.env,
    CI_PLATFORM: 'Windows',
    CI_STEPS_JSON: JSON.stringify(results({ lint: 'failure' })),
  };
  delete env.GITHUB_STEP_SUMMARY;
  await assert.rejects(
    execFileAsync(process.execPath, [cli], { cwd: root, env }),
    (error) => error.code === 1 && error.stdout.includes('failure'),
  );
  const runs = await readdir(join(root, 'reports', 'validation'));
  const stored = JSON.parse(
    await readFile(join(root, 'reports', 'validation', runs[0], 'report.json'), 'utf8'),
  );
  assert.equal(stored.status, 'failure');
});

test('CLI rejects absent or malformed outcome data rather than inventing results', async (t) => {
  const root = await fixture(t);
  const env = { ...process.env, CI_PLATFORM: 'Windows', CI_STEPS_JSON: '{' };
  delete env.GITHUB_STEP_SUMMARY;
  await assert.rejects(execFileAsync(process.execPath, [cli], { cwd: root, env }), /JSON/i);
  assert.deepEqual(await readdir(root), []);
});

test('GitHub summaries append only to an existing runner-owned file', async (t) => {
  const runner = await fixture(t);
  const summary = join(runner, 'summary.md');
  await writeFile(summary, 'existing\n');
  await appendGitHubSummary(summary, runner, 'new\n');
  assert.equal(await readFile(summary, 'utf8'), 'existing\nnew\n');
});

test('GitHub summary targets cannot escape the runner directory or follow links', async (t) => {
  const runner = await fixture(t);
  const outside = await fixture(t);
  const target = join(outside, 'summary.md');
  await writeFile(target, 'preserve\n');
  await assert.rejects(appendGitHubSummary(target, runner, 'bad\n'), /outside/i);
  const linkedDirectory = join(runner, 'linked');
  await symlink(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    appendGitHubSummary(join(linkedDirectory, 'summary.md'), runner, 'bad\n'),
    /outside|link/i,
  );
  assert.equal(await readFile(target, 'utf8'), 'preserve\n');
});
