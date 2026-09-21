import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { invalidArgumentsResult, runMaintenance } from './maintenance/driver.mjs';

export { runMaintenance };

export const HELP = `Bounded, non-runtime formatting maintenance

Usage: node scripts/maintenance.mjs [--apply | --dry-run]
       [--output reports/maintenance/<new-name>.json]
       [--patch reports/maintenance/<new-name>.patch]

Default/--dry-run: inspect Git-visible tracked and untracked files; do not repair.
--apply: require a clean worktree, format once, then run the existing npm run check.
--output/--patch: optional new, Git-ignored artifacts within reports/maintenance.
                 Relative paths only; existing files, symlinks and escapes are refused.
--help: print this help without inspecting or changing the repository.

Exit 0: clean or successfully applied and validated; 1: changes-needed; 2: refused/failed.
Stdout is one schemaVersion: 1 JSON receipt (except --help), never subprocess logs.
Receipt fields: mode, status, limits, inventory, formatter, repairPasses, changes
(paths/byte counts/SHA-256), validation (command/status/exit/duration/output byte count),
rollback (status/restoredPaths/conflictPaths), protection (hard policy/fingerprints),
artifacts, errors, timing. Timing excludes final receipt serialization/output.

Hard scope: known root Markdown docs/AGENTS, active docs/**/*.md, .github Markdown/YAML.
Never source, resources, manifests/locks, builds, scripts/tests, history, generated or
ignored inputs, binaries, symlinks or hard links. Editor configuration is not repaired.
Optional .github/maintenance.json: {"version":1,"include":["docs/**"],"exclude":[]}.
Includes only narrow the hard scope; excludes prevent candidate/fingerprint content reads.
Git/formatter/policy metadata is required input. Git-generated attributes and common
generated-file headers are excluded, as are hidden data directories.
Root .prettierrc.json supplies supported data-only styles; plugins, other configs and
embedded-language formatting are not executed. Git and .prettierignore are evaluated
independently; exclusion by either wins, regardless of negations in the other.
No commit, stash, reset, clean, install, push, pull request, merge or publication capability.
Validation runs trusted checkout scripts; this is not a sandbox for untrusted npm scripts.
Limits: 128 candidates, 256 KiB each/4 MiB total; formatter 15 s; npm check 180 s/
1 MiB output plus at most 3 s termination grace. Git: 10 s/2 MiB/10,000 inventory entries.
Protected-input fingerprints: 16 MiB/file, 128 MiB total, excluding unreadable policy scope.
Failure restores only the driver's own still-matching writes; concurrent edits survive.
`;

export function parseArgs(args) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (seen.has(argument)) throw new Error('Duplicate argument.');
    seen.add(argument);
    if (argument === '--apply') options.apply = true;
    else if (argument === '--dry-run') continue;
    else if (argument === '--help') options.help = true;
    else if (argument === '--output' || argument === '--patch') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Artifact flag requires a new path.');
      options[argument.slice(2)] = value;
    } else throw new Error('Unknown argument.');
  }
  if (seen.has('--apply') && seen.has('--dry-run')) throw new Error('Conflicting modes.');
  if (options.help && seen.size !== 1)
    throw new Error('--help cannot be combined with other flags.');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      const { receipt, exitCode } = await runMaintenance(options);
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      process.exitCode = exitCode;
    }
  } catch {
    const { receipt, exitCode } = invalidArgumentsResult(process.argv.slice(2).includes('--apply'));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = exitCode;
  }
}
