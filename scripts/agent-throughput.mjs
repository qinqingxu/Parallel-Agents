import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { prepareReportDirectory } from './ci-report.mjs';

const execFileAsync = promisify(execFile);
const WINDOW_DAYS = 90;
const MAX_PULL_REQUESTS = 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const categories = ['agent', 'human', 'dependency', 'otherAutomation'];
const pullRequestSearchQuery = `query($searchQuery: String!, $endCursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $endCursor) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
        mergedAt
        author {
          login
          __typename
        }
      }
    }
  }
}`;
const agentLogins = new Set([
  'chatgpt-codex-connector',
  'claude',
  'copilot',
  'copilot-swe-agent',
  'cursor',
  'devin-ai-integration',
  'gemini-code-assist',
  'github-copilot',
  'openai-codex',
]);

function normalizedLogin(author) {
  return typeof author?.login === 'string' ? author.login.toLowerCase() : '';
}

export function classifyAuthor(author) {
  const login = normalizedLogin(author);
  const baseLogin = login.replace(/\[bot\]$/, '');
  const automated =
    author?.type === 'Bot' || author?.__typename === 'Bot' || login.endsWith('[bot]');
  if (automated && agentLogins.has(baseLogin)) return 'agent';
  if (
    automated &&
    (baseLogin === 'dependabot' || baseLogin.startsWith('renovate') || baseLogin.startsWith('snyk'))
  ) {
    return 'dependency';
  }
  if (author?.type === 'User' || author?.__typename === 'User') return 'human';
  return 'otherAutomation';
}

export function parsePullRequestInput(payload) {
  let items;
  let totalCount;
  let incomplete;
  if (Array.isArray(payload) && payload.length > 0 && payload.every((page) => page?.data?.search)) {
    items = payload.flatMap((page) => page.data.search.nodes);
    totalCount = payload[0].data.search.issueCount;
    incomplete = false;
  } else if (
    Array.isArray(payload) &&
    payload.length > 0 &&
    payload.every((page) => page && Array.isArray(page.items))
  ) {
    items = payload.flatMap((page) => page.items);
    totalCount = payload[0].total_count;
    incomplete = payload.some((page) => page.incomplete_results === true);
  } else if (Array.isArray(payload)) {
    items = payload;
    totalCount = payload.length;
    incomplete = false;
  } else if (payload && Array.isArray(payload.items)) {
    items = payload.items;
    totalCount = payload.total_count;
    incomplete = payload.incomplete_results === true;
  } else {
    throw new Error(
      'PR metadata must be a GitHub Search response, paginated responses, or an array.',
    );
  }
  if (items.length > MAX_PULL_REQUESTS) {
    throw new Error('PR metadata exceeds the bounded 1,000-result limit.');
  }
  return {
    items,
    incomplete,
    truncated: Number.isInteger(totalCount) && totalCount > items.length,
  };
}

function round(value) {
  return Number(value.toFixed(4));
}

export function buildThroughputReport(input, options) {
  const generated = new Date(options.generatedAt);
  if (!Number.isFinite(generated.getTime())) throw new Error('generatedAt must be a valid date.');
  const repositoryParts = options.repository.split('/');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    repositoryParts.some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Repository must have the form owner/name.');
  }
  if (!['github-api', 'injected-json'].includes(options.source)) {
    throw new Error('Unknown report source.');
  }

  const start = generated.getTime() - WINDOW_DAYS * DAY_MS;
  const authorCounts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const item of input.items) {
    const mergedAt = item?.pull_request?.merged_at ?? item?.merged_at ?? item?.mergedAt;
    const merged = typeof mergedAt === 'string' ? Date.parse(mergedAt) : Number.NaN;
    if (!Number.isFinite(merged) || merged < start || merged > generated.getTime()) continue;
    authorCounts[classifyAuthor(item.user ?? item.author)] += 1;
  }

  const mergedPrCount = Object.values(authorCounts).reduce((sum, count) => sum + count, 0);
  const limitations = [
    'Author categories are inferred only from GitHub account type and a reviewed login-name policy; PR text, reviews, commits, and trailers are not inspected.',
    'The rolling window uses merged timestamps from GitHub repository metadata and does not measure effort, quality, or unmerged work.',
    input.incomplete
      ? 'GitHub Search marked its response incomplete, so this report understates activity.'
      : input.truncated
        ? 'GitHub Search reported more matches than it returned, so this bounded report understates activity.'
        : 'GitHub Search is limited to 1,000 matches; this report was not truncated at generation time.',
  ];

  return {
    windowDays: WINDOW_DAYS,
    mergedPrCount,
    agentAuthoredMergedCount: authorCounts.agent,
    agentAuthoredShare: mergedPrCount ? round(authorCounts.agent / mergedPrCount) : 0,
    prsPerDay: round(mergedPrCount / WINDOW_DAYS),
    generatedAt: generated.toISOString(),
    repository: options.repository,
    source: options.source,
    authorCounts,
    limitations,
  };
}

export function githubGraphqlArguments(repository, generatedAt) {
  const since = new Date(generatedAt.getTime() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const searchQuery = `repo:${repository} is:pr is:merged merged:>=${since}`;
  return [
    'api',
    'graphql',
    '--paginate',
    '--slurp',
    '-f',
    `query=${pullRequestSearchQuery}`,
    '-f',
    `searchQuery=${searchQuery}`,
  ];
}

async function fetchPullRequests(repository, generatedAt) {
  const { stdout } = await execFileAsync('gh', githubGraphqlArguments(repository, generatedAt), {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return parsePullRequestInput(JSON.parse(stdout));
}

export async function writeThroughputReport(root, report) {
  const directory = await prepareReportDirectory(root, 'agent-throughput');
  const stamp = report.generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const path = resolve(directory, `report-${stamp}-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return path;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!['--input', '--repository', '--now'].includes(name) || value === undefined) {
      throw new Error(
        'Usage: node scripts/agent-throughput.mjs --repository owner/name [--input file] [--now ISO-date]',
      );
    }
    if (name === '--input') options.input = value;
    if (name === '--repository') options.repository = value;
    if (name === '--now') options.now = value;
  }
  if (!options.repository) throw new Error('The --repository option is required.');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const generatedAt = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(generatedAt.getTime())) throw new Error('--now must be a valid date.');
  const input = options.input
    ? parsePullRequestInput(JSON.parse(await readFile(resolve(options.input), 'utf8')))
    : await fetchPullRequests(options.repository, generatedAt);
  const report = buildThroughputReport(input, {
    generatedAt: generatedAt.toISOString(),
    repository: options.repository,
    source: options.input ? 'injected-json' : 'github-api',
  });
  const path = await writeThroughputReport(process.cwd(), report);
  console.log(relative(process.cwd(), path));
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
