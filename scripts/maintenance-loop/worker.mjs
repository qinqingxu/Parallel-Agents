import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import {
  decodeText,
  readSafeFile,
  replaceMatching,
  safePath,
  safeRoot,
} from '../maintenance/filesystem.mjs';
import { makePatch } from '../maintenance/formatting.mjs';
import { fail } from '../maintenance/policy.mjs';
import { createCommands } from './commands.mjs';
import {
  assertDriverReceipt,
  assertSnapshotDelta,
  errorRecord,
  isolatedEnvironment,
  LOOP_LIMITS,
  newLoopReceipt,
  requireCandidateScripts,
  requireVerifierPlatform,
  sha256,
} from './contract.mjs';
import {
  candidateSummary,
  canonicalRoot,
  captureCandidate,
  copyCandidate,
  linkDependencies,
  nulNames,
  verifyScratch,
  writeNew,
} from './fixture.mjs';

const undefinedScript = 'maintenance-loop-intentionally-undefined';
const rawDocument = '# Maintenance loop fixture\r\n\r\n*   formatting drift\r\n';
const formattedDocument = '# Maintenance loop fixture\n\n- formatting drift\n';

function parseReceipt(content) {
  try {
    return JSON.parse(decodeText(content, 'maintenance receipt'));
  } catch {
    fail('missing-evidence', 'Maintenance did not return one valid JSON receipt.');
  }
}

export async function runWorker(sourceRoot, relativeRun) {
  const receipt = newLoopReceipt();
  const started = performance.now();
  let commands;
  try {
    requireVerifierPlatform();
    sourceRoot = await canonicalRoot(sourceRoot);
    if (!/^reports\/maintenance-loop\/[0-9]+-[a-f0-9-]{36}$/u.test(relativeRun)) {
      fail('unsafe-path', 'The worker requires a newly allocated maintenance-loop run.');
    }
    const run = await safeRoot((await safePath(sourceRoot, relativeRun)).target);
    const ownerFile = await readSafeFile(run, 'owner.json', 8192);
    const owner = parseReceipt(ownerFile.content);
    if (
      owner.schemaVersion !== 1 ||
      owner.sourceRoot !== sourceRoot ||
      owner.relativePath !== relativeRun
    ) {
      fail('unsafe-path', 'The worker ownership marker does not match this source and run.');
    }
    const scratch = await verifyScratch({ ...owner, root: run, owner: ownerFile });
    const saveArtifact = async (path, content, kind) => {
      const saved = await writeNew(run, path, content);
      const artifact = {
        path: `${relativeRun}/${path}`,
        kind,
        sha256: sha256(saved.content),
        bytes: saved.content.length,
      };
      receipt.artifacts.push(artifact);
      return artifact;
    };
    commands = createCommands({
      env: isolatedEnvironment(join(scratch, 'home')),
      onStep: (step, index) =>
        saveArtifact(
          `commands/${String(index).padStart(3, '0')}.json`,
          `${JSON.stringify(step)}\n`,
          step.progress ? 'parsed-command-progress' : 'real-command-result',
        ),
    });
    const source = await captureCandidate(sourceRoot, commands, 'source-before');
    if (!source.commit)
      fail('missing-source-commit', 'The source checkout must have a valid HEAD commit.');
    const manifestEntry = source.entries.find(
      ({ path, kind }) => path === 'package.json' && kind === 'file',
    );
    if (!manifestEntry) fail('missing-input', 'The current candidate is missing package.json.');
    const manifest = parseReceipt(manifestEntry.content);
    requireCandidateScripts(manifest);
    if (Object.hasOwn(manifest.scripts, undefinedScript)) {
      fail('fixture-collision', 'The intentionally undefined fixture command already exists.');
    }
    const summary = candidateSummary(source);
    receipt.source = {
      commit: summary.commit,
      contentSha256: summary.contentSha256,
      digestContract: summary.digestContract,
      statusSha256: summary.statusSha256,
      indexSha256: summary.indexSha256,
      files: summary.files,
      bytes: summary.bytes,
      missingPaths: summary.missingPaths,
      historyPaths: summary.historyPaths,
      excludedCounts: summary.excludedCounts,
    };
    await saveArtifact(
      'source-inventory.json',
      `${JSON.stringify(summary, null, 2)}\n`,
      'current-candidate-inventory',
    );
    const prettierCli = (await safePath(sourceRoot, 'node_modules/prettier/bin/prettier.cjs'))
      .target;
    const fixturePath = `docs/maintenance-loop-fixture-${relativeRun.split('-').at(-1)}.md`;
    if (source.entries.some(({ path }) => path === fixturePath)) {
      fail('fixture-collision', 'The generated fixture document unexpectedly exists.');
    }
    const materializedSource = {
      entries: source.entries.filter(({ kind }) => kind !== 'missing'),
    };

    const runCase = async (phase) => {
      const negative = phase === 'negative';
      const proof = { status: 'failed', path: fixturePath };
      receipt[phase] = proof;
      const root = join(scratch, phase);
      await mkdir(root);
      await copyCandidate(source, root);
      await commands.git(root, ['init', '--quiet', '--template='], `${phase}-init`);
      await linkDependencies(sourceRoot, root, commands);
      const copied = await captureCandidate(root, commands, `${phase}-copied`);
      assertSnapshotDelta(materializedSource, copied, []);
      proof.copiedContentSha256 = copied.contentSha256;
      const suffix = negative ? `\n\`npm run ${undefinedScript}\`\n` : '';
      const formatted = Buffer.from(formattedDocument + suffix);
      const raw = Buffer.from(rawDocument + suffix.replaceAll('\n', '\r\n'));
      const doc = await writeNew(root, fixturePath, negative ? formatted : raw);
      if (negative) {
        const unfixable = await commands.run(
          'negative-docs-contract',
          process.execPath,
          ['scripts/check-docs.mjs'],
          {
            cwd: root,
            accepted: [1],
          },
        );
        proof.unfixableCheck = {
          command: ['node', 'scripts/check-docs.mjs'],
          exitCode: unfixable.exitCode,
          status: unfixable.status,
          durationMs: unfixable.durationMs,
          reachedDocsCheck: true,
          stdoutSha256: sha256(unfixable.stdout),
          undefinedScript,
        };
        await replaceMatching(root, doc, raw);
      }
      const formatCheck = await commands.run(
        `${phase}-formatter-detect`,
        process.execPath,
        [prettierCli, '--check', fixturePath],
        {
          cwd: root,
          accepted: [1],
          timeoutMs: 15_000,
        },
      );
      proof.formatterBefore = {
        status: formatCheck.status,
        exitCode: formatCheck.exitCode,
        durationMs: formatCheck.durationMs,
      };
      await commands.git(root, ['add', '--all'], `${phase}-stage-disposable-candidate`);
      await commands.git(
        root,
        ['commit', '--quiet', '-m', 'Disposable maintenance loop candidate'],
        `${phase}-commit-disposable-candidate`,
      );
      const before = await captureCandidate(root, commands, `${phase}-before`);
      if (before.statusSha256 !== sha256(Buffer.alloc(0))) {
        fail('dirty-fixture', 'The disposable candidate must be clean before native maintenance.');
      }
      proof.fixtureCommit = before.commit;
      proof.beforeSha256 = sha256(raw);
      const native = async (apply) => {
        const stage = apply ? 'apply' : 'detect';
        const output = `reports/maintenance/${phase}-${stage}.json`;
        const patch = `reports/maintenance/${phase}-${stage}.patch`;
        const result = await commands.run(
          `${phase}-maintenance-${stage}`,
          process.execPath,
          [
            'scripts/maintenance.mjs',
            ...(apply ? ['--apply'] : []),
            '--output',
            output,
            '--patch',
            patch,
          ],
          { cwd: root, accepted: [0, 1, 2], timeoutMs: LOOP_LIMITS.maintenanceTimeoutMs },
        );
        const parsed = parseReceipt(result.stdout);
        proof[apply ? 'maintenance' : 'detection'] = parsed;
        const outputFile = await readSafeFile(root, output, LOOP_LIMITS.maxOutputBytes);
        await saveArtifact(
          `${phase}-${stage}.json`,
          outputFile.content,
          'native-maintenance-receipt',
        );
        if (!isDeepStrictEqual(parsed, parseReceipt(outputFile.content))) {
          fail('missing-evidence', 'Native stdout and the on-disk receipt disagree.');
        }
        const patchFile = await readSafeFile(root, patch, LOOP_LIMITS.maxOutputBytes);
        await saveArtifact(
          `${phase}-${stage}.patch`,
          patchFile.content,
          'native-maintenance-patch',
        );
        if (result.exitCode !== (apply ? (negative ? 2 : 0) : 1)) {
          fail(
            'missing-evidence',
            'Native maintenance returned an unexpected real exit; inspect its saved receipt.',
          );
        }
        assertDriverReceipt(parsed, {
          phase: apply ? phase : 'detect',
          path: fixturePath,
          beforeSha256: sha256(raw),
          afterSha256: sha256(formatted),
        });
        if (
          !patchFile.content.equals(
            Buffer.from(
              makePatch([{ path: fixturePath, before: { content: raw }, after: formatted }]),
            ),
          )
        ) {
          fail(
            'missing-evidence',
            'The actual native patch does not describe exactly the fixture document.',
          );
        }
        return patch;
      };
      await native(false);
      if (!(await readSafeFile(root, fixturePath, raw.length)).content.equals(raw)) {
        fail('unexpected-diff', 'Read-only native detection modified the fixture.');
      }
      const nativePatch = await native(true);
      const after = await captureCandidate(root, commands, `${phase}-after`);
      Object.assign(proof, assertSnapshotDelta(before, after, negative ? [] : [fixturePath]));
      if (before.indexSha256 !== after.indexSha256 || before.commit !== after.commit) {
        fail('unexpected-diff', 'Validation changed the disposable Git index or HEAD.');
      }
      const diffPaths = nulNames(
        await commands.git(
          root,
          ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD'],
          `${phase}-actual-git-diff`,
        ),
      );
      if (!isDeepStrictEqual(diffPaths, proof.changedPaths)) {
        fail(
          'unexpected-diff',
          'Git and the byte inventory disagree about the exact candidate diff.',
        );
      }
      const finalDoc = await readSafeFile(root, fixturePath, LOOP_LIMITS.maxFileBytes);
      if (!finalDoc.content.equals(negative ? raw : formatted)) {
        fail('missing-evidence', 'The repair or rollback is not byte-exact.');
      }
      if (negative) {
        proof.restoredSha256 = sha256(finalDoc.content);
        await commands.run(
          'negative-docs-failure-preserved',
          process.execPath,
          ['scripts/check-docs.mjs'],
          { cwd: root, accepted: [1] },
        );
      } else {
        proof.afterSha256 = sha256(finalDoc.content);
        const cleanFormat = await commands.run(
          'positive-formatter-repaired',
          process.execPath,
          [prettierCli, '--check', fixturePath],
          { cwd: root, timeoutMs: 15_000 },
        );
        proof.formatterAfter = {
          status: cleanFormat.status,
          exitCode: cleanFormat.exitCode,
          durationMs: cleanFormat.durationMs,
        };
        await commands.git(
          root,
          ['apply', '--check', '--reverse', nativePatch],
          'positive-real-patch-check',
        );
        const diff = await commands.git(
          root,
          ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD'],
          'positive-real-patch',
        );
        if (!diff.length) fail('missing-evidence', 'The real positive Git diff is empty.');
        await saveArtifact('positive-git.diff', diff, 'actual-git-diff');
      }
      proof.status = 'passed';
    };

    await runCase('positive');
    await runCase('negative');
    const afterSource = await captureCandidate(sourceRoot, commands, 'source-after');
    const delta = assertSnapshotDelta(source, afterSource, []);
    if (
      source.commit !== afterSource.commit ||
      source.indexSha256 !== afterSource.indexSha256 ||
      source.statusSha256 !== afterSource.statusSha256
    ) {
      fail(
        'concurrent-edit',
        'The original checkout Git state changed; no contributor work was reset.',
      );
    }
    receipt.checkoutProtection = {
      status: 'unchanged',
      scope:
        'Current admitted Git-visible bytes/topology plus HEAD, index entries and status; ignored/private content is not read or qualified',
      beforeSha256: source.contentSha256,
      afterSha256: afterSource.contentSha256,
      files: source.files,
      protectedInputs: delta.protection,
    };
    await saveArtifact(
      'command-ledger.json',
      `${JSON.stringify(commands.steps, null, 2)}\n`,
      'real-command-ledger',
    );
    receipt.status = 'passed';
  } catch (error) {
    receipt.errors.push(errorRecord(error));
  } finally {
    receipt.commands = commands?.steps ?? [];
    receipt.timing.finishedAt = new Date().toISOString();
    receipt.timing.durationMs = Math.round(performance.now() - started);
  }
  return receipt;
}

if (import.meta.main) {
  const receipt = await runWorker(process.argv[2], process.argv[3]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.status === 'passed' ? 0 : 1;
}
