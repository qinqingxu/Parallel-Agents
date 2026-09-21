# Non-runtime maintenance protocol v1

This documents the implemented [maintenance CLI](../../scripts/maintenance.mjs), not a plan or
evidence of a hosted run. The tool never changes application behavior, publishes, or bypasses review.

## Invocation and exit status

```powershell
node scripts/maintenance.mjs [--apply | --dry-run] [--output reports/maintenance/new.json] [--patch reports/maintenance/new.patch]
```

Default and explicit dry-run are read-only inspections. Apply requires a clean working tree.
Artifact paths must be new, relative, Git-ignored paths under `reports/maintenance`.

| Exit | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | Clean inspection, or an explicitly applied candidate that passed validation |
| `1`  | Formatting changes are needed; no repair was applied                        |
| `2`  | Refused, failed, or conflicted operation; inspect the receipt               |

Except for help, stdout is one version-one JSON receipt, not subprocess logs. Invalid CLI
arguments and operational errors retain explicit failure semantics.

## Scope and budgets

Only known root Markdown documents, active `docs` Markdown, and `.github` Markdown/YAML are
candidates. Application source/resources, manifests/locks, build inputs, scripts/tests, history,
generated/ignored paths, binaries, links, and editor configuration are excluded.
An optional `.github/maintenance.json` with `version: 1`, `include`, and `exclude` can narrow
the hard boundary but cannot widen it.

Limits include 128 candidates, 256 KiB per candidate, 4 MiB total candidate data, one repair
pass, 15-second formatting, and 180-second validation with bounded output and termination grace.
Git inventory and protected-input fingerprinting also have explicit budgets reported in the receipt.
Unsupported executable Prettier configurations/plugins are refused, and embedded-language
formatting is disabled. Validation runs trusted repository scripts; this is not an arbitrary-code sandbox.

## Mutation and rollback

Apply records before-content/hashes, formats only permitted files, and runs `npm run check`.
It verifies protected input fingerprints rather than interpreting a green command alone as safety.
Unexpected protected changes are reported, never reset by the tool.

Failure restores only the driver's own still-matching writes. Concurrent edits, replacement
artifacts, or conflicting state are preserved and reported instead of overwritten. Existing
report/patch paths and linked destinations are refused before repair.

## Receipt semantics

`schemaVersion` is `1`; `tool` is `non-runtime-maintenance`. The receipt includes:

- Requested mode and final status, limits, inventory counts, and formatter details.
- Repair-pass count and changed paths with byte counts and SHA-256 values.
- Validation command/status/exit/timing/output-size evidence.
- Rollback status, restored paths, and conflict paths.
- Protection scope and before/after fingerprints.
- Artifact publication state, errors, and bounded-operation timing.

Timing excludes final serialization/output, as identified in the receipt. A clean read-only
inspection has zero repair passes and no validation run; it must not be presented as an applied fix.
Consumers must check mode, status, validation, rollback, protection, and artifact state together.
Breaking interpretation changes require a new protocol version.

The [proposal workflow](../../.github/workflows/maintenance.yml) uses read-only repository permissions
and always checks out the current trusted default branch. It handles scheduled/manual requests and
failed validation of this repository's default-branch pushes, not fork/PR failures or arbitrary head
revisions. A proposal is not a rerun or repair claim about the older triggering commit.
Generated patches require a human decision; configuration alone does not prove scheduler activation
or a merged repair.
