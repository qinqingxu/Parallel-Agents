# Engineering automation and evidence

These tools improve repository maintenance without changing the application's runtime behavior.
The [agent guide](../AGENTS.md) remains the shared boundary contract.

## Plain CI steps and versioned receipts

[Validate](../.github/workflows/ci.yml) uses the runner's normal shell and separately names
installation, lint, format verification, type checking, tests, documentation contracts, build,
agent instruction corpus validation, Windows native/package checks, and dependency audit. Failures
retain their original step outcome.

`npm run test:ci` writes `junit.xml`, `coverage.lcov`, and `result.json` in a fresh directory under
`reports/tests`. It never reuses predictable output files, which could be links to unrelated data.
Coverage describes executed modules, not total application or native-runtime coverage.
`npm run ci:report` consumes the actual `CI_PLATFORM` and `CI_STEPS_JSON` workflow values,
writes a unique receipt/summary under `reports/validation`, and returns nonzero when required
checks failed or did not complete. It never invents missing results.

`npm run check:agent-corpus` validates the repository-shipped agent instructions, prompts, and
skills as a bounded machine-operable corpus. It verifies required files, frontmatter, prompt
sections, learned-rule lifecycle state, repeated active-rule evidence, and repository containment
without invoking a provider model or changing application runtime files. Candidate and retired
learned rules are validated but not consumed by later agent runs.

The [version-two JSON schema](../schemas/validation-report.v2.schema.json) is the current consumer
contract; [version one](../schemas/validation-report.v1.schema.json) remains available for
historical receipts.
The report describes workflow-step outcomes; it is not independent proof of a live provider,
installer/signing qualification, or remote branch-policy enforcement.

## Agent throughput report

[Agent throughput report](../.github/workflows/agent-throughput.yml) runs weekly or by manual
dispatch with read-only repository permissions. It queries GitHub GraphQL pull-request metadata
through `gh api`, selecting only author login/type, merge timestamp, and pagination/count metadata.
It measures merged pull requests in the rolling 90 days ending at generation time and uploads the
unique JSON file under `reports/agent-throughput`. It does not inspect provider histories or
application data and does not write to the repository.

For an authenticated repository query:

```powershell
node scripts/agent-throughput.mjs --repository owner/name
```

Tests and reproducible local inspection can inject a GitHub GraphQL JSON response without network
access:

```powershell
node scripts/agent-throughput.mjs --repository owner/name --input tests/fixtures/agent-throughput-graphql-prs.json --now 2026-09-18T00:00:00.000Z
```

Each report records `windowDays`, merged PR count, agent-authored merged count and share,
PRs-per-day, generation time, repository, source, category counts, and limitations. Classification
uses only GitHub account type and a reviewed login-name policy: known coding-agent names are
`agent`, Dependabot/Renovate/Snyk names are `dependency`, remaining `User` accounts are `human`, and
all other identities are `otherAutomation`. The artifact contains aggregates only; it does not
serialize tokens, environment variables, PR/review bodies, commit text, or author logins.

GitHub Search returns at most 1,000 results. The report is therefore bounded and explicitly records
when the API total indicates truncation or GitHub marks a response incomplete. Login-based
classification can be imperfect, and PR counts do not measure effort, quality, unmerged work, or
whether an agent had human assistance. Workflow configuration and a generated artifact also do not
establish required-check enforcement.

CI requests an additional [source-bound evidence envelope](specs/evidence-v1.md) with
`--with-provenance`. It requires an unchanged committed checkout and binds the outcome receipt
to current source/artifact hashes. It does not upgrade caller-supplied outcomes into independent proof.
The [bounded local MCP tools](agent-tools.md) expose the same diagnostics, read-only maintenance
inspection, fixed validation, and evidence verification without arbitrary commands or mutation APIs.

[Documentation contracts](../.github/workflows/documentation.yml) also run as a small standalone PR
check without dependency installation. This keeps a broken package install or an unrelated native
job from hiding stale links/commands. The checker still deliberately covers a narrow executable
contract, not all prose semantics; required-check enforcement remains an owner decision.

## Opt-in local hooks

```powershell
npm run hooks:install
npm run hooks:install -- --apply
npm run hooks:install -- --check
```

The first command only previews. `--apply` explicitly installs the
[native Git hook](../.githooks/pre-commit) through repository-local `core.hooksPath`.
**This Git configuration is shared by linked worktrees.** Installation refuses to replace an
existing default hook content or inherited/custom hook policy. Non-sample files in the default hooks
directory cause installation to stop rather than bypassing another hook type.
No setup command installs hooks automatically.

For contributors already using the optional `pre-commit` framework,
[.pre-commit-config.yaml](../.pre-commit-config.yaml) is an alternative entry point to the same
`npm run check` gate. Choose one hook manager; do not stack installations or bypass an existing policy.
The native hook validates the current working tree, not an independently exported staged snapshot.
The PR's CI checks remain the authoritative committed-tree validation.

Before validation, the hook clears Git's repository-local environment. The test runners and Git
fixtures also isolate it: `git -C` alone does not override an absolute inherited `GIT_INDEX_FILE`,
`GIT_DIR`, or `GIT_WORK_TREE`, so otherwise fixture commands could change the caller's real index.

## Security checks

[Security checks](../.github/workflows/security.yml) defines official CodeQL analysis without an
application build, a pinned local Gitleaks source scan, and dependency-change review only when
GitHub Dependency Graph is available for the repository. CodeQL gets only the permission needed
to upload security findings; the other jobs do not get repository write access.
Configured triggers include PRs, main-branch pushes, weekly checks, and manual runs.

```powershell
npm run check:secrets
npm run test:security
```

These commands require Go. The source scanner builds the pinned Gitleaks module into a guarded
repository-local tool cache under `reports/tools`, not a machine-wide installation. It snapshots
Git-visible working-tree source, including untracked files, and excludes ignored files and known
binary media. It does not follow links, expand archives, or silently skip over-budget source files.
It never uploads code or findings from a local run.

Reports under `reports/security` are fully redacted and retain the scope and pinned scanner version.
The separate generated-credential test proves positive detection and verifies that credential text
does not appear in the SARIF output. Its expected finding is synthetic, not a repository credential.
No reported findings does not mean every historical commit, binary asset, or live environment was scanned.
CodeQL and dependency-review definitions still require hosted execution; local validation does not
claim that those remote analyses already ran.
If Dependency Graph is disabled, the dependency-review job records that owner setting and skips the
unsupported action instead of failing every PR for an unavailable service. The required dependency
security gate remains `npm audit --audit-level=high` in validation.

## Copilot workflows

[Copilot setup steps](../.github/workflows/copilot-setup-steps.yml) prepares the non-GUI Ubuntu
development environment with pinned Node/Go, locked dependencies, and local checks. It does not
change firewall policy, install hooks, provide credentials, or qualify native Linux desktop behavior.
Copilot only uses the special workflow after it exists on the default branch.

The [validation skill](../.github/skills/validate-changes/SKILL.md) gives a repeatable local procedure.
The [validation repair prompt](../.github/prompts/validation-repair.prompt.md) consumes only active
entries from the [learned-rule corpus](../.github/agent-rules/learned-rules.json); the MCP
`repository_doctor` tool exposes the same active subset to clients.
The [recurring Copilot review workflow](../.github/workflows/recurring-copilot-review.yml) adds a
pull-request review handoff. It runs from the trusted base context, captures the PR diff through
GitHub APIs without executing PR-controlled code, and gives repository tokens only to the review
step. Its configured output is review guidance, not proof that a finding was observed, fixed, or
promoted into the learned-rule corpus.
The [maintenance evidence reviewer](../.github/agents/maintenance-review.agent.md) is manually invoked,
read-only, and cannot edit, execute commands, or publish. A human remains responsible for applying
patches, creating pull requests, and merging.

Claude Code users can enter through [CLAUDE.md](../CLAUDE.md), which points to the same shared guide.
[Project-level settings](../.claude/settings.json) add narrow deny/ask rules without auto-approving
commands, selecting a model, disabling normal permissions, or installing hooks. Local settings
remain ignored. These patterns are convenience guardrails, not a complete shell sandbox; see the
[provider's permission semantics](https://code.claude.com/docs/en/permissions).
No Claude session, authentication, or runtime policy activation was performed to author this configuration.

## Bounded maintenance proposals

```powershell
npm run maintenance:check
npm run maintenance:apply -- --output reports/maintenance/new-run.json --patch reports/maintenance/new-run.patch
```

Check mode is read-only and works with an intentionally dirty checkout. Apply is explicit and
requires a clean worktree; do not stash, reset, or delete edits to satisfy it.
The driver repairs only its hard-bounded non-runtime formatting scope, validates once, protects
source/build inputs by fingerprints, and preserves concurrent edits if rollback would conflict.
Artifacts must be new relative paths beneath the ignored maintenance-report directory.

[The proposal workflow](../.github/workflows/maintenance.yml) runs weekly, on manual dispatch,
or after a failed `Validate` push run from this repository's default branch. Fork/PR failure events
do not qualify. Every path checks out the current trusted default branch, never an event-supplied
head revision. It has read-only repository permissions and produces artifacts, not commits,
pull requests, or automatic merges. A failed repair retains truthful failure/rollback evidence
rather than presenting a patch as validated. A clean current-branch inspection does not mean
the older triggering CI run was repaired or rerun successfully.

Use the [maintenance review skill](../.github/skills/review-maintenance/SKILL.md) and
[version-one protocol](specs/maintenance-v1.md) before accepting a proposal. This is a bounded
formatting loop, not general self-healing application code or proof of active remote enforcement.

The separate [maintenance recovery verifier](self-healing-ci.md) exercises real detection,
repair, revalidation and negative rollback on disposable whole-candidate copies. Its
`npm run test:maintenance-loop` command is Windows-only and deliberately outside the recursive
`check` graph. The dedicated read-only workflow retains source-bound local-fixture receipts;
neither the verifier nor its artifacts imply autonomous merging or production recovery.

## Owner-controlled enforcement

Files in the working tree do not activate remote automation or required review. After reviewing and
publishing the changes, the repository owner should check real workflow results and decide which
status checks and reviews must block merging. No remote policy or publication is performed by these
local tooling commands.
