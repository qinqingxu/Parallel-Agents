# Validation receipt protocol v1

This is the previous version-one consumer contract for historical
[CI receipts](../../scripts/ci-report.mjs), not a development plan or a claim that a workflow ran.
Current receipts use [Validation receipt protocol v2](validation-v2.md).
The machine-readable definition is
[validation-report.v1.schema.json](../../schemas/validation-report.v1.schema.json).

## Inputs and authority

The workflow provides `CI_PLATFORM` (`Windows` or `Linux`) and `CI_STEPS_JSON`, an object containing
exactly these check names: `install`, `lint`, `format`, `typecheck`, `tests`, `docs`, `build`,
`native`, and `audit`. Every outcome must be `success`, `failure`, `cancelled`, or `skipped`.
Missing names, unknown names, unsupported platforms, and invented outcomes are errors.

These values must come from the corresponding workflow step outcomes. Manually supplied values
can test the reporter but cannot prove that validation occurred.

## Result semantics

All checks are required on Windows. Linux requires every check except `native`, which must
explicitly be `skipped`; the desktop runtime remains Windows-only.

The overall result is computed from required checks in this order:

1. Any failure produces `failure`.
2. Otherwise, any cancellation produces `cancelled`.
3. Otherwise, any required non-success produces `incomplete`.
4. Only success from every required check produces `success`.

The CLI returns nonzero for failed, cancelled, incomplete, or malformed-input runs.
It never treats the presence of a log or a skipped check as successful execution.

## Output and retention

Each receipt contains:

| Field            | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `schemaVersion`  | Integer `1`                                                                    |
| `evidenceSource` | Literal `workflow-step-outcomes`                                               |
| `generatedAt`    | UTC collection timestamp                                                       |
| `platform`       | The workflow platform                                                          |
| `status`         | Computed overall result                                                        |
| `checks`         | Nine records containing name, reproduction command, outcome, and required flag |
| `guidance`       | Fixed reproduction guidance for required checks that did not succeed           |

JSON and Markdown are written into a new directory under `reports/validation`; existing runs
are not overwritten. A GitHub step summary may be appended only within the runner's designated
temporary directory. Directory links and escaping destinations are rejected.

Unit-test evidence is separate: `npm run test:ci` creates a fresh `reports/tests` run directory
containing JUnit XML, tested-module LCOV, and an execution receipt. Successful execution must
actually produce the required reporter files. Predictable old paths are never reused.

## Limits and compatibility

This receipt does not establish live-provider compatibility, complete coverage, installer/signing
qualification, branch-protection enforcement, or successful deployment. Consumers must inspect
the source revision and accompanying artifacts, not just a `success` string.

Breaking key, outcome, or required-check changes require a new schema/protocol version. Version-one
consumers must not silently reinterpret later versions. Current property-contract and negative CLI
tests in [ci-report.test.mjs](../../tests/ci-report.test.mjs) protect the latest schema while this
document preserves the historical v1 shape.
