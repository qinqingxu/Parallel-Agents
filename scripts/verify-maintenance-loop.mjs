import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { readSafeFile, safePath } from './maintenance/filesystem.mjs';
import { fail } from './maintenance/policy.mjs';
import { runOwnedProcess } from './maintenance/process.mjs';
import { createCommands, processEvidence } from './maintenance-loop/commands.mjs';
import {
  errorRecord,
  isolatedEnvironment,
  LOOP_LIMITS,
  newLoopReceipt,
  requireVerifierPlatform,
  sha256,
} from './maintenance-loop/contract.mjs';
import {
  canonicalRoot,
  createRunDirectory,
  removeScratch,
  retainedRunPaths,
  RunAllocationError,
  verifyReportRoot,
  writeNew,
} from './maintenance-loop/fixture.mjs';

export const HELP = `Windows non-runtime maintenance integration verifier (local-fixture only)

Usage: node scripts/verify-maintenance-loop.mjs
       node scripts/verify-maintenance-loop.mjs --help

Run on Windows from the Parallel Agents checkout root with its existing node_modules.
API: await verifyMaintenanceLoop({ root }) -> { receipt, receiptPath, exitCode }.
No configurable validation, output destinations, repairs of the source checkout or retries.

Copies the current Git-visible candidate, including relevant dirty/untracked content, to
two disposable repositories outside the caller's Git ancestry, in a new temporary folder.
Private/ignored/generated content is excluded. Historical
content is not read; verified historical path existence alone is mirrored for docs links.
A scoped ignored dependency junction/symlink is used read-only; no install is performed.
The fixed npm check graph must still select tests/*.test.mjs, never this separate E2E.
The test command is pinned to the exact --test-concurrency=4 form with its existing
isolation flags and glob. Legacy commands and arbitrary variants are refused;
the verifier never changes the declared test command, selection or concurrency.

Positive: real formatter failure -> clean disposable commit -> native maintenance detect
and one repair -> actual npm run check passes -> exact document diff and protected hashes.
Negative: actual docs-contract validation fails the deliberately invalid docs command even
when formatted -> introduce drift -> native check failure -> owned byte-exact rollback.
The existing maintenance driver and its 180-second validation limit are unchanged. Each native
maintenance subprocess gets a 240-second hosted-runner budget inside the 540-second total verifier
deadline.

A supervised worker has a 540-second total limit plus at most 3 seconds termination grace;
direct commands are sequential and capped at 128. Candidate limits: 10,000 entries,
16 MiB/file and 128 MiB total. Existing npm/test descendants retain their normal behavior.
Cleanup removes only this run's identity-checked temporary scratch directory, never the
original checkout or previous reports. An in-repository system TEMP directory is refused.
Partial allocation failures retain their phase, original error code and acquired ownership.
Verified scratch is removed once; failed/unverified cleanup preserves and reports retained
paths. Report directories retain failure evidence. Publication failure preserves the
failure/cleanup context in the returned/stdout receipt; the API receiptPath is null.
Reports are new schemaVersion: 1 receipts/artifacts under reports/maintenance-loop/<unique>.
Command records include the effective timeout. Verifier-launched npm-check stdout is
parsed before any failure is rethrown: npm stages, completed-result counts, static test
source locations, recent/slowest observed results and available reporter totals.
Progress has its own schemaVersion: 1 and a 256 KiB artifact cap (2 MiB captured input,
20,000 lines, 12 recent/5 slow results). Raw titles, logs and assertion diagnostics are
not saved. Command artifacts are hashed even on failure. Reporter buffering/concurrency
means the last observed result is NOT the stalled test. The native maintenance driver's
nested validation output remains unavailable; its process/validation receipts are unchanged.
Stdout is the receipt JSON. Exit 0 requires both real cases, source protection, artifact
verification and cleanup; 1 means failed/unverified; 2 means invalid CLI arguments.
Other platforms are refused: the shared POSIX process-group helper cannot terminate all
nested detached validation groups. Run this separate E2E only in a Windows CI job.
Not a sandbox, hosted CI, production/native qualification, composite score or release.
No real checkout commit, push, PR, policy change, provider invocation or publication.
`;

export function parseArgs(args) {
  if (!args.length) return {};
  if (args.length === 1 && args[0] === '--help') return { help: true };
  fail('invalid-arguments', 'Invalid arguments; only the fixed verifier or --help is supported.');
}

export async function verifyMaintenanceLoop(options = {}) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  let receipt = newLoopReceipt();
  let run;
  let allocationFailed = false;
  let receiptPath = null;
  try {
    requireVerifierPlatform();
    if (
      !options ||
      Object.keys(options).some((key) => key !== 'root') ||
      (options.root !== undefined && typeof options.root !== 'string')
    ) {
      fail('invalid-options', 'Only an optional source checkout root is accepted.');
    }
    const root = await canonicalRoot(options.root ?? process.cwd());
    await safePath(root, 'reports', { missing: true });
    const setup = createCommands({
      env: isolatedEnvironment(join(root, 'reports', `maintenance-loop-unopened-${randomUUID()}`)),
    });
    receipt.setupCommands = setup.steps;
    run = await createRunDirectory(root, setup);
    const worker = fileURLToPath(new URL('./maintenance-loop/worker.mjs', import.meta.url));
    const args = [worker, root, run.relativePath];
    const result = await runOwnedProcess(process.execPath, args, {
      cwd: root,
      env: isolatedEnvironment(run.home),
      timeoutMs: Math.max(1, LOOP_LIMITS.totalTimeoutMs - Math.round(performance.now() - started)),
      maxOutputBytes: LOOP_LIMITS.maxOutputBytes,
      capture: true,
    });
    const supervision = processEvidence([process.execPath, ...args], root, result);
    receipt.supervision = supervision;
    if (
      !['passed', 'failed'].includes(result.status) ||
      ![0, 1].includes(result.exitCode) ||
      result.terminationFailed
    ) {
      fail(
        'worker-failed',
        `The owned verifier worker failed (${result.status}, exit ${result.exitCode ?? 'none'}). Partial per-command records remain in this run.`,
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.toString('utf8'));
    } catch {
      fail('missing-evidence', 'The worker did not produce a complete JSON receipt.');
    }
    if (
      parsed?.schemaVersion !== 1 ||
      parsed.tool !== 'maintenance-loop-verifier' ||
      parsed.scope !== 'local-fixture-only' ||
      parsed.status !== (result.exitCode === 0 ? 'passed' : 'failed') ||
      !Array.isArray(parsed.commands) ||
      parsed.commands.length > LOOP_LIMITS.maxCommands ||
      !Array.isArray(parsed.artifacts)
    ) {
      fail('missing-evidence', 'The worker protocol or real exit disagrees with its receipt.');
    }
    receipt = { ...parsed, supervision, setupCommands: setup.steps };
    for (const artifact of receipt.artifacts) {
      if (!artifact.path.startsWith(`${run.relativePath}/`)) {
        fail('missing-evidence', 'An artifact path is outside this owned run.');
      }
      const actual = await readSafeFile(root, artifact.path, LOOP_LIMITS.maxOutputBytes);
      if (sha256(actual.content) !== artifact.sha256 || actual.content.length !== artifact.bytes) {
        fail('missing-evidence', 'An artifact changed or is missing from this run.', artifact.path);
      }
    }
  } catch (error) {
    receipt.status = 'failed';
    receipt.errors.push(errorRecord(error));
    if (error instanceof RunAllocationError) {
      allocationFailed = true;
      run = error.run;
      receipt.allocation = {
        status: 'failed',
        phase: error.phase,
        cause: errorRecord(error.cause),
        allocatedPaths: [run.root, run.scratch].filter(Boolean),
        retainedPaths: error.retainedPaths,
      };
      receipt.cleanup = error.cleanup;
      if (error.cleanup.error) receipt.errors.push(error.cleanup.error);
    }
  } finally {
    if (run && !allocationFailed) {
      try {
        if (receipt.supervision?.terminationFailed) {
          fail(
            'cleanup-unverified',
            'An owned process might still be running; its scratch data is preserved.',
          );
        }
        await removeScratch(run);
        receipt.cleanup = { status: 'removed', path: run.scratch };
      } catch (error) {
        receipt.status = 'failed';
        receipt.cleanup = {
          status: 'failed',
          path: run.scratch,
          error: errorRecord(error),
          retainedPaths: await retainedRunPaths(run),
        };
        receipt.errors.push(errorRecord(error));
      }
    }
    receipt.timing = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      scope:
        'Supervision, actual commands, artifact verification and owned cleanup; excludes final receipt serialization',
    };
  }
  if (receipt.timing.durationMs >= 600_000) {
    receipt.status = 'failed';
    receipt.errors.push({
      code: 'limit-exceeded',
      message: 'The verifier exceeded the ten-minute total contract.',
    });
  }
  if (run?.root) {
    try {
      const reportRoot = await verifyReportRoot(run);
      const saved = await writeNew(
        reportRoot,
        'receipt.json',
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
      receiptPath = join(reportRoot, saved.path);
    } catch (error) {
      receipt.status = 'failed';
      receipt.reporting = {
        status: 'failed',
        path: join(run.root, 'receipt.json'),
        error: errorRecord(error),
        retainedPaths: await retainedRunPaths(run),
      };
      receipt.errors.push(errorRecord(error));
    }
  }
  return { receipt, receiptPath, exitCode: receipt.status === 'passed' ? 0 : 1 };
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      const result = await verifyMaintenanceLoop();
      process.stdout.write(`${JSON.stringify(result.receipt, null, 2)}\n`);
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    const receipt = newLoopReceipt();
    receipt.errors.push(errorRecord(error));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = error?.code === 'invalid-arguments' ? 2 : 1;
  }
}
