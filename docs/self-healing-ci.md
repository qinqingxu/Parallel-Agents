# Bounded maintenance recovery verification

The repository's self-healing scope is deliberately narrow: repair an allowed formatting defect,
run the real validation gate, and roll back owned changes if validation fails. This is not general
AI code repair, automatic merging, deployment recovery, or a claim that production is autonomous.

[The integration verifier](../scripts/verify-maintenance-loop.mjs) exercises the existing maintenance
driver against disposable copies of the whole current candidate, not a mock validator or a
hand-written success receipt.

```powershell
npm run test:maintenance-loop
```

This separate end-to-end command requires Windows and installed dependencies. It is not in
`npm test` or `npm run check`, so validating a repair cannot recursively invoke its own experiment.

## Detection, remediation, verification and rollback

The positive case introduces one allowed document-format defect in a disposable repository.
The actual formatter first fails. The real maintenance driver detects and applies exactly one
repair, runs the actual `npm run check`, and must leave only the intended document diff.
Protected source/build bytes must remain unchanged.

The negative case creates a deliberately invalid documentation contract that formatting cannot
repair. The actual full check must reach and fail that contract, even with valid formatting.
After introducing format drift, maintenance attempts its bounded repair, sees the real validation
failure, and restores its own document bytes exactly. The remaining diff must be empty.

Both cases use current Git-visible source, including relevant uncommitted content. Private,
ignored and generated content is excluded. Historical content is not read: only verified path
existence is mirrored for documentation references and explicitly recorded in the snapshot contract.
The existing dependency installation is shared through an ignored fixture link; no package install
or provider request is made by the verifier. Trusted local scripts are not an OS sandbox.

## Evidence and limits

A new `reports/maintenance-loop` run contains a version-one receipt and hashed diagnostic artifacts.
It records source commit/current-content digest, actual commands and exits, the positive and negative
cases, protected before/after comparisons, and scratch cleanup.
Source HEAD, index, working status, and current content must remain unchanged.
Exit zero requires the real cases, artifact checks and cleanup to pass.
The end-to-end test also emits and verifies an [evidence envelope](specs/evidence-v1.md) binding
the verifier receipt to the original current-source fingerprint. It remains explicitly a
local-fixture observation, not independent hosted execution or production qualification.

On command failure, bounded parsed progress is persisted before returning the error: observed npm
stages, test-result counts and static source locations are retained without raw titles or logs.
Buffered observations do not identify which test was running when a timeout occurred.
Setup failures retain partial-allocation ownership and actual cleanup/retention state instead of
claiming that scratch was never created. Unverified or concurrently changed scratch is not deleted.

The supervised worker has a 540-second total bound and at most 128 sequential direct commands.
Each native maintenance subprocess has a 240-second hosted-runner budget, while the nested native
maintenance validation limit remains 180 seconds. There is no automatic retry loop, scope widening,
forced rollback over concurrent edits, source checkout repair, commit, or publication.
The full verifier refuses non-Windows hosts because the existing process-group model cannot safely
terminate every nested detached validation group there.

[The dedicated workflow](../.github/workflows/self-healing.yml) runs this experiment on Windows PR,
main-push and manual events with read-only repository permissions. A local success establishes
local-fixture behavior only; actual hosted execution must be inspected after publishing.

The existing [maintenance proposal workflow](../.github/workflows/maintenance.yml) remains separate:
it inspects the trusted current default branch, may repair only allowed formatting, and emits a
proposal requiring human review. The integration verifier does not claim that an older failing
workflow was repaired, that branch checks are enforced, or that a generated patch was merged.
