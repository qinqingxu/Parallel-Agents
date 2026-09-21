import { createHash } from 'node:crypto';
import { join, parse } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { withoutRepositoryGitEnvironment } from '../git-environment.mjs';
import { candidatePath, fail, protectedPath } from '../maintenance/policy.mjs';
import { validationEnvironment } from '../maintenance/process.mjs';

export const LOOP_LIMITS = Object.freeze({
  totalTimeoutMs: 540_000,
  maintenanceTimeoutMs: 240_000,
  validationTimeoutMs: 120_000,
  gitTimeoutMs: 10_000,
  maxCommands: 128,
  maxConcurrentDirectCommands: 1,
  maxOutputBytes: 2 * 1024 * 1024,
  maxFiles: 10_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
});

export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

export function requireVerifierPlatform(platform = process.platform) {
  if (platform !== 'win32') {
    fail(
      'unsupported-platform',
      'The full loop requires Windows PID-tree termination for nested npm/maintenance processes; portable focused tests do not run the loop.',
    );
  }
}

export function newLoopReceipt() {
  return {
    schemaVersion: 1,
    tool: 'maintenance-loop-verifier',
    scope: 'local-fixture-only',
    status: 'failed',
    limits: {
      ...LOOP_LIMITS,
      processScope:
        'One supervised worker and sequential direct commands; npm/test descendants retain their existing behavior and share the owned process-tree deadline',
      terminationGraceMs: 3_000,
    },
    source: null,
    positive: { status: 'not-run' },
    negative: { status: 'not-run' },
    checkoutProtection: { status: 'unverified' },
    cleanup: { status: 'not-created' },
    commands: [],
    artifacts: [],
    errors: [],
    limitations: [
      'The full verifier is Windows-only: the existing POSIX helper cannot supervise nested detached process groups as one PID tree.',
      'Local disposable fixtures only: not hosted CI, production/native qualification, scoring, release or remote policy evidence.',
      'Trusted current checkout scripts and installed dependencies, not a sandbox for untrusted code or an OS network firewall. No install, provider, publication or network command is requested.',
      'The dependency junction/symlink is used read-only, not an OS-enforced read-only mount; ignored installed-package contents are outside the candidate digest.',
      'Repository-local Git ignores and hard private/generated exclusions define copy scope; isolated HOME deliberately does not load personal global Git configuration.',
      'Excluded historical content is never read: only verified Git-visible path existence is mirrored for the real documentation reference contract.',
      'No retries of maintenance or its read-consistency guard. Incomplete validation, concurrent edits, missing evidence and cleanup conflicts fail visibly.',
      'Verifier-launched npm-check progress is advisory, parsed from captured stdout before failure is rethrown. Native maintenance does not expose its nested test output, and buffered reporter observations do not identify an in-flight or stalled test.',
    ],
    timing: { startedAt: new Date().toISOString(), finishedAt: null, durationMs: 0 },
  };
}

export function isolatedEnvironment(home, source = process.env) {
  const env = validationEnvironment(withoutRepositoryGitEnvironment(source));
  for (const key of Object.keys(env)) {
    if (
      ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP'].includes(key.toUpperCase())
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: parse(home).root.replace(/[\\/]$/u, ''),
    HOMEPATH: home.slice(parse(home).root.length - 1),
    TEMP: join(home, 'tmp'),
    TMP: join(home, 'tmp'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
    npm_config_userconfig: join(home, '.npmrc'),
    npm_config_globalconfig: join(home, '.global-npmrc'),
    npm_config_cache: join(home, '.npm'),
    npm_config_offline: 'true',
  };
}

const requiredScripts = Object.freeze({
  check:
    'npm run lint && npm run format:check && npm run typecheck && npm test && npm run check:docs && npm run check:agent-corpus',
  lint: 'eslint . --max-warnings 0',
  'format:check': 'prettier --check .',
  typecheck: 'tsc --noEmit',
  test: 'node --test --test-concurrency=4 --import ./tests/helpers/isolated-git.mjs --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/*.test.mjs',
  'check:docs': 'node scripts/check-docs.mjs --check-contract',
  'check:agent-corpus': 'node scripts/check-agent-corpus.mjs',
});

export function requireCandidateScripts(manifest) {
  if (!manifest || manifest.name !== 'parallel-agents' || !manifest.scripts) {
    fail(
      'unsupported-check-contract',
      'This verifier requires the Parallel Agents check contract.',
    );
  }
  for (const [name, command] of Object.entries(requiredScripts)) {
    if (
      manifest.scripts[name] !== command ||
      Object.hasOwn(manifest.scripts, `pre${name}`) ||
      Object.hasOwn(manifest.scripts, `post${name}`)
    ) {
      fail(
        'unsupported-check-contract',
        'The fixed local check graph changed or gained a lifecycle hook; review the verifier before running.',
        name,
      );
    }
  }
}

export function entrySummary(entry) {
  return {
    path: entry.path,
    kind: entry.kind,
    sha256: entry.sha256,
    bytes: entry.bytes,
    executable: entry.executable,
  };
}

export function digestEntries(entries) {
  return sha256(JSON.stringify(entries.map(entrySummary)));
}

export function assertSnapshotDelta(before, after, expectedPaths) {
  if (expectedPaths.some((path) => !candidatePath(path))) {
    fail('unexpected-diff', 'Only an allowed generated fixture document may differ.');
  }
  const left = new Map(before.entries.map((entry) => [entry.path, entrySummary(entry)]));
  const right = new Map(after.entries.map((entry) => [entry.path, entrySummary(entry)]));
  const changedPaths = [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => !isDeepStrictEqual(left.get(path), right.get(path)))
    .sort();
  if (!isDeepStrictEqual(changedPaths, [...expectedPaths].sort())) {
    fail('unexpected-diff', 'The candidate diff is not exactly the expected fixture-only change.');
  }
  const protectedEntries = (snapshot) =>
    snapshot.entries.filter((entry) => entry.kind === 'file' && protectedPath(entry.path));
  const protectedBefore = protectedEntries(before);
  const protectedAfter = protectedEntries(after);
  const beforeSha256 = digestEntries(protectedBefore);
  const afterSha256 = digestEntries(protectedAfter);
  if (!protectedBefore.length || beforeSha256 !== afterSha256) {
    fail('missing-evidence', 'Protected source, resources, scripts/tests or build inputs differ.');
  }
  return {
    changedPaths,
    protection: {
      status: 'unchanged',
      scope:
        'All copied Git-visible source/resources/scripts/tests and root build contracts, including Prettier-ignored inputs',
      beforeSha256,
      afterSha256,
      files: protectedBefore.length,
    },
  };
}

export function assertDriverReceipt(receipt, { phase, path, beforeSha256, afterSha256 }) {
  const detecting = phase === 'detect';
  const negative = phase === 'negative';
  const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  const change = receipt?.changes?.[0];
  const validation = receipt?.validation?.[0];
  const protection = receipt?.protection;
  const rollback = receipt?.rollback;
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const valid =
    ['detect', 'positive', 'negative'].includes(phase) &&
    receipt?.schemaVersion === 1 &&
    receipt.tool === 'non-runtime-maintenance' &&
    receipt.mode === (detecting ? 'check' : 'apply') &&
    receipt.status === (detecting ? 'changes-needed' : negative ? 'failed' : 'applied') &&
    receipt.repairPasses === (detecting ? 0 : 1) &&
    receipt.limits?.validationTimeoutMs === LOOP_LIMITS.validationTimeoutMs &&
    Array.isArray(receipt.changes) &&
    receipt.changes.length === 1 &&
    object(change) &&
    Array.isArray(receipt.validation) &&
    (detecting || object(validation)) &&
    Array.isArray(receipt.errors) &&
    receipt.errors.every(object) &&
    candidatePath(path) &&
    change.path === path &&
    change.beforeSha256 === beforeSha256 &&
    validHash(change.beforeSha256) &&
    validHash(change.afterSha256) &&
    change.beforeSha256 !== change.afterSha256 &&
    (afterSha256 === undefined || change.afterSha256 === afterSha256) &&
    Number.isSafeInteger(change.beforeBytes) &&
    change.beforeBytes > 0 &&
    Number.isSafeInteger(change.afterBytes) &&
    change.afterBytes > 0 &&
    isDeepStrictEqual(protection?.writtenPaths, detecting ? [] : [path]) &&
    validHash(protection?.beforeSha256) &&
    protection.beforeSha256 === protection.afterSha256 &&
    Number.isSafeInteger(protection.filesBefore) &&
    protection.filesBefore > 0 &&
    protection.filesBefore === protection.filesAfter &&
    rollback?.status === (negative ? 'restored' : 'not-needed') &&
    isDeepStrictEqual(rollback.restoredPaths, negative ? [path] : []) &&
    isDeepStrictEqual(rollback.conflictPaths, []) &&
    isDeepStrictEqual(
      receipt.errors.map(({ code }) => code),
      negative ? ['validation-failed'] : [],
    ) &&
    (detecting
      ? isDeepStrictEqual(receipt.validation, [])
      : receipt.validation?.length === 1 &&
        isDeepStrictEqual(validation.command, ['npm', 'run', 'check']) &&
        validation.status === (negative ? 'failed' : 'passed') &&
        validation.exitCode === (negative ? 1 : 0) &&
        validation.terminationFailed === false &&
        Number.isSafeInteger(validation.durationMs) &&
        validation.durationMs > 0);
  if (!valid) {
    fail(
      'missing-evidence',
      `The ${phase} maintenance receipt lacks the required real evidence.`,
      path,
    );
  }
  return change;
}

export function errorRecord(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'operation-failed',
    message:
      error?.name === 'MaintenanceError'
        ? error.message
        : 'A verifier filesystem, protocol or process operation failed; no raw diagnostic content is included.',
    ...(error?.name === 'MaintenanceError' && error.path ? { path: error.path } : {}),
  };
}
