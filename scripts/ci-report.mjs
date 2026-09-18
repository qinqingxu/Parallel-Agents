import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCandidate, sealEvidence } from './evidence/provenance.mjs';

const commands = {
  install: 'npm ci',
  lint: 'npm run lint',
  format: 'npm run format:check',
  typecheck: 'npm run typecheck',
  tests: 'npm run test:ci',
  docs: 'npm run check:docs',
  'agent-corpus': 'npm run check:agent-corpus',
  build: 'npm run build',
  native: 'npm run pack',
  audit: 'npm audit --audit-level=high',
};
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);

function isInside(root, path) {
  const suffix = relative(root, path);
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function ensureDirectory(parent, name) {
  const path = join(parent, name);
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Report directory must not be a link: ${path}`);
  if (!info.isDirectory()) throw new Error(`Expected a report directory: ${path}`);
  return path;
}

export async function prepareReports(root) {
  return ensureDirectory(await realpath(root), 'reports');
}

export async function prepareReportDirectory(root, category) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(category)) throw new Error('Invalid report category.');
  return ensureDirectory(await prepareReports(root), category);
}

export function summarizeResults(platform, results) {
  if (!['Windows', 'Linux'].includes(platform))
    throw new Error(`Unsupported CI platform: ${platform}`);
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    throw new Error('CI step results must be an object.');
  }
  for (const name of Object.keys(results)) {
    if (!Object.hasOwn(commands, name)) throw new Error(`Unknown CI check: ${name}`);
  }
  const checks = Object.entries(commands).map(([name, command]) => {
    if (!Object.hasOwn(results, name)) throw new Error(`Missing CI check: ${name}`);
    if (!outcomes.has(results[name]))
      throw new Error(`Invalid outcome for ${name}: ${results[name]}`);
    return {
      name,
      command,
      outcome: results[name],
      required: name !== 'native' || platform === 'Windows',
    };
  });
  if (platform === 'Linux' && results.native !== 'skipped') {
    throw new Error(
      'The Linux native check must be explicitly skipped; desktop support is Windows-only.',
    );
  }
  const required = checks.filter((check) => check.required);
  const status = required.some((check) => check.outcome === 'failure')
    ? 'failure'
    : required.some((check) => check.outcome === 'cancelled')
      ? 'cancelled'
      : required.some((check) => check.outcome !== 'success')
        ? 'incomplete'
        : 'success';
  const guidance = required
    .filter((check) => check.outcome !== 'success')
    .map(
      (check) =>
        `${check.name}: reproduce with \`${check.command}\`; inspect the failed step before editing.`,
    );
  return {
    schemaVersion: 2,
    evidenceSource: 'workflow-step-outcomes',
    generatedAt: new Date().toISOString(),
    platform,
    status,
    checks,
    guidance,
  };
}

function markdownFor(report) {
  const rows = report.checks.map(
    (check) =>
      `| ${check.name} | ${check.outcome} | ${check.required ? 'yes' : 'no'} | \`${check.command}\` |`,
  );
  const guidance = report.guidance.length
    ? report.guidance.map((item) => `- ${item}`).join('\n')
    : 'All required workflow steps reported success.';
  return [
    `## Validation (${report.platform})`,
    '',
    `Result: **${report.status}**`,
    '',
    '| Check | Outcome | Required | Reproduction |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    guidance,
    '',
    'This receipt records workflow-step outcomes; it is not a live-provider or production qualification.',
    '',
  ].join('\n');
}

export async function writeReport(root, report) {
  const runs = await prepareReportDirectory(root, 'validation');
  const run = await ensureDirectory(runs, `${Date.now()}-${randomUUID()}`);
  const jsonPath = join(run, 'report.json');
  const markdownPath = join(run, 'summary.md');
  const markdown = markdownFor(report);
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await writeFile(markdownPath, markdown, { flag: 'wx' });
  return { jsonPath, markdownPath, markdown };
}

export async function appendGitHubSummary(summaryPath, runnerTemp, markdown) {
  if (!summaryPath || !runnerTemp)
    throw new Error('GitHub summary requires a runner-owned target.');
  const root = await realpath(runnerTemp);
  const path = resolve(summaryPath);
  const canonical = await realpath(path);
  if (!isInside(root, canonical)) {
    throw new Error('GitHub summary target is outside the runner directory.');
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error('GitHub summary must be a regular file, not a link.');
  await appendFile(canonical, markdown);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--prepare') {
    console.log(await prepareReports(process.cwd()));
    return;
  }
  const withProvenance = args.length === 1 && args[0] === '--with-provenance';
  if (args.length && !withProvenance)
    throw new Error('Usage: node scripts/ci-report.mjs [--prepare | --with-provenance]');
  let results;
  try {
    results = JSON.parse(process.env.CI_STEPS_JSON ?? '');
  } catch (error) {
    throw new Error('CI_STEPS_JSON must contain actual workflow outcomes as JSON.', {
      cause: error,
    });
  }
  const report = summarizeResults(process.env.CI_PLATFORM, results);
  const source = withProvenance ? await captureCandidate(process.cwd()) : null;
  if (source?.dirty)
    throw new Error('Workflow provenance requires an unchanged committed checkout.');
  const written = await writeReport(process.cwd(), report);
  if (source) {
    const path = (file) => relative(process.cwd(), file).split(sep).join('/');
    const output = path(join(written.jsonPath, '..', 'evidence.json'));
    await sealEvidence(process.cwd(), {
      source,
      origin: 'workflow-step-outcomes',
      artifacts: [path(written.jsonPath)],
      output,
    });
    console.log(`Evidence: ${output}`);
  }
  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_STEP_SUMMARY) {
    await appendGitHubSummary(
      process.env.GITHUB_STEP_SUMMARY,
      process.env.RUNNER_TEMP,
      written.markdown,
    );
  }
  console.log(`${report.status}: ${relative(process.cwd(), written.jsonPath)}`);
  if (report.status !== 'success') process.exitCode = 1;
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1]))) === (await realpath(fileURLToPath(import.meta.url)))
) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
