import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildThroughputReport,
  classifyAuthor,
  parsePullRequestInput,
} from '../scripts/agent-throughput.mjs';

const execFileAsync = promisify(execFile);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const cli = resolve(testDirectory, '..', 'scripts', 'agent-throughput.mjs');
const input = resolve(testDirectory, 'fixtures', 'agent-throughput-prs.json');
const generatedAt = '2026-09-18T00:00:00.000Z';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'parallel-agents-throughput-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('author classification distinguishes agents, people, dependencies, and other bots', () => {
  assert.equal(classifyAuthor({ login: 'copilot-swe-agent[bot]', type: 'Bot' }), 'agent');
  assert.equal(classifyAuthor({ login: 'renovate[bot]', type: 'Bot' }), 'dependency');
  assert.equal(classifyAuthor({ login: 'github-actions[bot]', type: 'Bot' }), 'otherAutomation');
  assert.equal(classifyAuthor({ login: 'octocat', type: 'User' }), 'human');
  assert.equal(classifyAuthor({ login: 'recursor-human', type: 'User' }), 'human');
});

test('fixture metadata produces a bounded rolling 90-day aggregate', async () => {
  const payload = JSON.parse(await readFile(input, 'utf8'));
  const parsed = parsePullRequestInput(payload);
  const report = buildThroughputReport(parsed, {
    generatedAt,
    repository: 'qinqingxu/Parallel-Agents',
    source: 'injected-json',
  });

  assert.equal(report.windowDays, 90);
  assert.equal(report.mergedPrCount, 5);
  assert.equal(report.agentAuthoredMergedCount, 1);
  assert.equal(report.agentAuthoredShare, 0.2);
  assert.equal(report.prsPerDay, 0.0556);
  assert.deepEqual(report.authorCounts, {
    agent: 1,
    human: 2,
    dependency: 1,
    otherAutomation: 1,
  });
  assert.equal(report.generatedAt, generatedAt);
  assert.equal(report.repository, 'qinqingxu/Parallel-Agents');
  assert.equal(report.source, 'injected-json');
  assert.ok(report.limitations.every((item) => typeof item === 'string'));
});

test('invalid repositories, dates, and oversized inputs fail closed', () => {
  assert.throws(
    () =>
      buildThroughputReport(parsePullRequestInput([]), {
        generatedAt: 'not-a-date',
        repository: 'owner/repo',
        source: 'injected-json',
      }),
    /generated/i,
  );
  assert.throws(
    () =>
      buildThroughputReport(parsePullRequestInput([]), {
        generatedAt,
        repository: '../repo',
        source: 'injected-json',
      }),
    /repository/i,
  );
  assert.throws(() => parsePullRequestInput(Array.from({ length: 1001 }, () => ({}))), /1,000/);
});

test('CLI consumes fixture JSON without network and writes only aggregate metadata', async (t) => {
  const root = await fixture(t);
  const env = { ...process.env, GH_TOKEN: 'token-must-not-appear' };
  const { stdout } = await execFileAsync(
    process.execPath,
    [cli, '--input', input, '--repository', 'qinqingxu/Parallel-Agents', '--now', generatedAt],
    { cwd: root, env },
  );

  const reportDirectory = join(root, 'reports', 'agent-throughput');
  const files = await readdir(reportDirectory);
  assert.equal(files.length, 1);
  const serialized = await readFile(join(reportDirectory, files[0]), 'utf8');
  const report = JSON.parse(serialized);
  assert.equal(report.mergedPrCount, 5);
  assert.match(stdout, /reports[/\\]agent-throughput/);
  assert.doesNotMatch(serialized, /token-must-not-appear|fixture-token|fixture-review|raw review/);
  assert.deepEqual(Object.keys(report).sort(), [
    'agentAuthoredMergedCount',
    'agentAuthoredShare',
    'authorCounts',
    'generatedAt',
    'limitations',
    'mergedPrCount',
    'prsPerDay',
    'repository',
    'source',
    'windowDays',
  ]);
});
