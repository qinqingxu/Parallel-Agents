# Source-bound engineering evidence v1

An execution result is useful only when reviewers can identify the code and artifacts it describes.
The [evidence envelope](../../schemas/evidence.v1.schema.json) binds those bytes without pretending
to be a signed attestation or independent proof of execution.

## Source and artifact binding

[The provenance helper](../../scripts/evidence/provenance.mjs) records the local commit and a
SHA-256 fingerprint of Git-visible current source/configuration/documentation inputs. Untracked
inputs are included; ignored/generated output and historical media/design material are excluded.
Deleted tracked inputs remain represented. Links and over-budget inputs are rejected.

Each artifact has a constrained repository-relative report path, byte length, and SHA-256.
Envelopes are new files, not replacements. Creating an envelope verifies that the current source
still matches the checkpoint captured before the local check. Verifying it rechecks current source
and artifact bytes; a stale source, replaced artifact, malformed envelope, or path escape fails.

```powershell
npm run evidence:verify -- reports/validation/new-run/evidence.json
```

Use an actual existing run path, not the example placeholder.

## Trusted execution versus declared outcomes

`origin` distinguishes `local-command`, `workflow-step-outcomes`, and `local-maintenance-fixture`.
`independentExecutionProof` is always `false`: hashes prove content binding, not that a caller
honestly ran a command. Consumers must still inspect real execution logs, exits, scope, workflow
revision, and any fixture limitations. A failed check can have valid content binding.

CI's `npm run ci:report -- --with-provenance` requires an unchanged committed checkout and emits
an envelope beside the current validation outcome receipt. A modified checkout cannot produce
that workflow-provenance mode. Provenance remains a separate envelope rather than a silent schema
change to the validation receipt.

Local tool checks record the source before running one fixed check, then seal the actual result.
A source change during validation prevents sealing. This does not validate ignored files, binaries
outside the declared scope, provider accounts, deployment, or installed branch-protection settings.

## Compatibility

Version-one consumers accept the declared origin values, source contract, and bounded artifact list.
Breaking interpretation changes require a new version. Verification failures must not be replaced
with a success-shaped fallback or ignored simply because the JSON parses.
