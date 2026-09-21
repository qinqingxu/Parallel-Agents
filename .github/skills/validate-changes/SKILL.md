---
name: validate-changes
description: Validate Parallel Agents changes with the repository's real local, CI, native, and security checks without accessing live provider data or publishing.
---

# Validate changes

Use this workflow when asked to validate a change, reproduce a failing check, or prepare review evidence.
Follow the shared [repository boundaries](../../../AGENTS.md).

## Establish scope

1. Inspect the working-tree status and the requested behavior. Preserve pre-existing edits.
2. Run `npm run doctor` when diagnosing environment setup. Use `npm ci` only for missing dependencies
   or a changed lockfile; do not install machine-wide build tools as a workaround.
3. For engineering-only work, record a baseline of application source, resources, runtime dependencies,
   and build configuration. Verify it is unchanged afterward.

## Run the actual gates

```powershell
npm run check
npm run build
```

`check` includes lint, formatting verification, strict types, unit/regression tests, executable
documentation contracts, and the agent instruction corpus validator. A successful build alone is not enough.

For machine-readable unit-test evidence, use `npm run test:ci`. It writes JUnit and LCOV artifacts
under `reports`; coverage describes executed modules, not complete application coverage.

For native/UI/runtime-dependency changes on Windows, run `npm run test:e2e` after the build.
The existing isolated Electron test uses generated home/provider fixtures and inert CLI shims.
For packaging changes, use `npm run pack`, which includes source and actual packaged-payload checks
and explicitly disables publishing. Never substitute live provider sessions or disable the network
block to make an offline test pass.

For secret-detection changes, run `npm run test:security` and `npm run check:secrets`.
These use pinned local tooling, generated fixture credentials, redacted results, and Git-visible
source scope. Go is a prerequisite; no provider authentication is needed.

## If a check fails

- Stop at the failing layer and reproduce the smallest failing command or test selector.
- Add a failing regression before changing behavior. Do not hide a failure with a catch, a skipped
  check, or a widened exclusion.
- Formatting repair is explicit: inspect before using `npm run format`. For narrowly scoped
  maintenance, start with `npm run maintenance:check`; do not mutate application files to obtain a score.
- Read the workflow receipt and its reproduction guidance. Do not manufacture `CI_STEPS_JSON`
  values or report a skipped workflow step as success.

## Report evidence

State the exact commands, exit status, test counts, relevant artifact paths, and unverified boundaries.
When an evidence envelope is available, run `npm run evidence:verify --` with its existing report
path to check current source/artifact binding. Valid hashes do not turn declared outcomes into
independent proof; stale or mismatched evidence must remain a visible failure.
Distinguish local success from hosted CI execution, required-review enforcement, installer/signing
qualification, and live-provider compatibility. Do not commit, push, merge, or promote releases
unless that action was requested.
