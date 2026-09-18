# Contributing to Parallel Agents

Start with the [README](README.md), [architecture map](ARCHITECTURE.md), and shared
[agent guide](AGENTS.md). Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
For substantial changes, discuss scope in the
[repository's issues](https://github.com/jelllove/Parallel-Agents/issues) before expanding the product.
Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## Windows-first setup

- **Windows x64** is the desktop packaging target.
- [.node-version](.node-version) pins **Node.js 24.17.0** for reproducible setup.
  [package.json](package.json) permits Node `^24.17.0` and npm `>=11 <12` (**npm 11**).
- **Git** must be available on PATH for the Git panel and Git fixture tests.
- Agent CLIs and credentials are only needed for explicitly testing those agents interactively,
  not for the local static, type, unit/regression, or documentation checks.

```powershell
git clone https://github.com/jelllove/Parallel-Agents.git
Set-Location .\Parallel-Agents
npm ci
npm run dev
```

Use `npm ci` to install the lockfile's dependency graph rather than casually regenerating the
lockfile. Installation may download dependencies and native artifacts; it is not an offline step.
Do not commit local credentials or machine-specific configuration.

For explicit environment diagnostics and a locked setup sequence, use `npm run doctor` and
`npm run setup`. The [development environment guide](docs/development-environment.md) documents
JSON output, direct-Node invocation, the native PowerShell entry point, VS Code tasks, and the
optional isolated non-GUI dev container. Setup does not install Git hooks or global build tools.

### Native-terminal troubleshooting

Standard Windows x64 installation and packaging use the official prebuilds in `node-pty`
1.2.0-beta.13. This upstream release uses `node-addon-api` and ships N-API binaries, including
`prebuilds\win32-x64`. Those upstream prebuilds have passed the real Electron 43.6 native PTY fixture;
they do not need a source rebuild simply because the host Node and Electron runtimes differ.

Keep `build.npmRebuild: false` in [package.json](package.json) and retain the upstream prebuilds.
This prevents electron-builder from attempting an unnecessary native source compilation, which
can fail on missing compiler/Spectre libraries. It does not disable Spectre mitigations or modify
the system. The native smoke gates, rather than an automatic compiler invocation, check the
bindings used before and after packaging.

**Windows Build Tools and matching Spectre libraries are only needed for explicit
`npm run rebuild` / source-build workflows**, not the standard prebuilt install/package path.
For an intentional source build:

1. Confirm the supported Node/npm versions, Windows architecture, and the compiler/toolset selected
   for the rebuild. If the normal installation unexpectedly tries to compile, first inspect the
   locked package/prebuild installation rather than automatically changing the machine.
2. Install the required Visual Studio C++ Build Tools, Windows SDK, Python, and Spectre-mitigated
   libraries matching the selected MSVC toolset and target architecture.
3. Review [install-vs-buildtools.ps1](install-vs-buildtools.ps1) and
   [install-spectre-libs.ps1](install-spectre-libs.ps1), including their targeted versions, before
   choosing to use them. These helpers may download substantial workloads and request elevation.
4. Run `npm run rebuild` only for the intended source rebuild, then run the relevant native checks.
   Do not disable Spectre mitigations to bypass missing-library errors.

Do not automatically install global tools, elevate privileges, or change execution policy while
investigating a local check failure.

## Local commands

Run these at the repository root. The definitions in [package.json](package.json) are authoritative.

For optional agent-driven tooling, see [bounded local MCP tools](docs/agent-tools.md).
They expose diagnostics, read-only maintenance inspection, fixed validation commands and source-bound
evidence verification; they cannot install, publish, run arbitrary commands, or apply maintenance.

| Command                     | Contract                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `npm ci`                    | Install the locked dependency graph                                                         |
| `npm run doctor`            | Inspect required and optional prerequisites without installation or provider access         |
| `npm run setup`             | Explicit locked dependency installation followed by non-GUI repository checks               |
| `npm run dev`               | Start electron-vite's development application; this can read real user data                 |
| `npm run typecheck`         | Run TypeScript checking without emitting bundles                                            |
| `npm run lint`              | Check the active JavaScript/TypeScript code with ESLint                                     |
| `npm run format:check`      | Verify formatting without rewriting files                                                   |
| `npm run format`            | Apply formatting; inspect the diff and avoid unrelated rewrites                             |
| `npm test`                  | Run the Node test suite with TypeScript stripping                                           |
| `npm run test:ci`           | Run unit/regression tests with JUnit and tested-module LCOV output                          |
| `npm run test:e2e`          | Run the existing Windows native smoke after a build                                         |
| `npm run check:docs`        | Run the offline, bounded Markdown-to-repository contract check described below              |
| `npm run check:secrets`     | Scan Git-visible source with pinned, fully redacted local Gitleaks tooling                  |
| `npm run test:security`     | Verify real scanner detection/redaction using generated disposable data                     |
| `npm run hooks:install`     | Preview opt-in local hook setup; mutation requires explicit `--apply`                       |
| `npm run maintenance:check` | Inspect bounded non-runtime formatting drift without repair                                 |
| `npm run maintenance:apply` | Explicit clean-tree formatting repair with validation, rollback, and optional new artifacts |
| `npm run check`             | Run lint, format checking, type checking, tests, and documentation checks                   |
| `npm run build`             | Run type checking, then electron-vite build into `out`                                      |
| `npm run validate`          | Run `check` followed by `build`                                                             |

Start with the smallest relevant test command. Use `npm run check` for the complete local
static/type/test/docs gate, and `npm run validate` when bundle validation is also needed.
There is no requirement to package or publish an ordinary documentation or regression fix.
These local commands do not establish that remote CI ran or that branch protection is configured.

`npm run test:coverage` is optional and runs the same Node test selection with
`--experimental-test-coverage`. The report measures the modules loaded by those tests; unimported
production modules are not a whole-repository coverage denominator. Treat it as tested-module
feedback, not a claim of complete source, renderer, or native Electron/PTY coverage. It is not a
separate percentage gate or part of `check`.

### Targeted regression tests

Use the existing `node:test` harness. Write a fixture that fails for the reported behavior before
implementing the fix, then run that test and any directly coupled tests. For example, the docs
checker tests run using only Node's built-in modules, without installing dependencies:

```powershell
node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests\check-docs.test.mjs
```

Test filesystem behavior in fresh temporary directories, not real projects or provider histories.
The docs checker tests allocate disposable fixture repositories under `reports` and remove only
their own directories with test cleanup hooks. Inject paths, fake PTY launchers, or IPC stand-ins
where available; isolate HOME/USERPROFILE before importing modules that capture home paths.
Git tests should use isolated repositories and identities, with hooks/signing disabled for fixtures.
Never reset, clean, or delete a contributor's working tree to make a test pass.

PTY lifecycle regression tests use the injected class in
[src/main/pty-session-manager.ts](src/main/pty-session-manager.ts) with mocked timers. Keep them
independent of [src/main/pty-manager.ts](src/main/pty-manager.ts), the production native singleton.
Test stale callbacks, normal forwarding/bounds/cleanup, and explicit resize/kill error reporting
at this deterministic seam; use smoke tests separately for the real native binding.

`npm test` does not require ambient AI-provider access.
Normal, coverage and CI test runs cap Node's test-file workers at four. The suite creates many
independent Git/process fixtures; the bound limits contention on shared Windows hosts without
removing tests or extending maintenance validation deadlines.

The [engineering automation guide](docs/automation.md) explains optional hooks, security-tool
prerequisites, workflow receipts, and human approval boundaries. Neither setup nor ordinary checks
install hooks, mutate remote settings, or contact real AI-provider CLIs.

### Windows native smoke test

The native smoke test is **Windows-only** and separate from the fast `npm run check` workflow.
`npm run validate` remains **check plus build**; it does not include native smoke testing.
Use an installed dependency tree, Git on PATH, and the bundled Windows x64 N-API prebuilds.
The standard smoke path does not require a local C++ toolchain. The smoke command does not build
the application for you:

```powershell
npm run build
npm run test:smoke
```

[scripts/smoke.mjs](scripts/smoke.mjs) starts real Electron through
[tests/e2e/electron.e2e.cjs](tests/e2e/electron.e2e.cjs). It generates a temporary
home, separate Electron userData/sessionData directories, Claude JSONL history, and a disposable
Git repository. HOME/USERPROFILE point to the generated home, and inert `.cmd` provider shims are
prepended to PATH. Real Electron, Git, and `cmd.exe` are exercised, but **no real AI-provider CLI
or provider account is contacted**. The outer runner removes its temporary home in a `finally` block.

The test window's Electron session blocks all HTTP(S) requests. This tests the renderer's offline
asset path; it is not a machine-wide network firewall. The fixture selects the generated Claude
project through the actual UI and double-clicks its Git change to open the diff, rather than
verifying only an IPC response.

The fixture checks:

- The sandboxed preload bridge, context isolation, and absence of Node `require` in the renderer.
- Concurrent project preferences and settings IPC updates retaining the changed fields.
- Git IPC comparing the index to later working-tree content, and filesystem IPC reading only
  the fixture's visible entries.
- A real native `cmd.exe` PTY executing an echo and exiting successfully.
- The initial inert agent command reaching the mounted terminal and both staged/working fixture
  revisions appearing in the Monaco diff with HTTP(S) blocked.
- Safe handling of the `window-all-closed` tray lifecycle event. This is not a full tray/installer
  end-to-end test.

A successful run writes `reports\smoke.json` and a window capture at `reports\smoke.png`.
Use the command's exit status and the JSON `success`/`checks`/`error` fields as evidence for that
run. The report also records `electron` and `packaged`; a passing ordinary smoke report with
`packaged: false` is not packaged-runtime verification. Prerequisite failures can happen before
a new report is written; a leftover screenshot is not proof of a passing run.
This is native fixture verification, not a live-provider test.

For editor changes, preserve [the lazy local Monaco loader](ARCHITECTURE.md#offline-diff-loading)
and use this fixture to catch accidental CDN fallback. Do not unblock HTTP(S) or switch to a real
provider account to make the offline regression pass.

### Optional local packaging

The exact gate order for both package commands is **build → native smoke → electron-builder
with `--publish never` → packaged smoke**. A failed gate stops the command.

- `npm run pack`: build, native smoke check, unpacked electron-builder output with `--publish never`,
  then the packaged smoke check.
- `npm run dist`: build, native smoke check, configured distribution output with `--publish never`,
  then the packaged smoke check.
- `npm run release`: run `pack`, then [promote the output](scripts/promote-latest.cjs) to
  `release\latest`, **removing any previous directory at that destination**.

Despite its name, `release` performs local packaging/promotion, not GitHub or npm publishing.
Keep the explicit `--publish never` arguments in `pack` and `dist`.

Do not upload artifacts, invoke publishing, or replace a user's existing release directory without
an explicit request. Packaging may need downloads even though publishing is disabled.

`npm run test:packaged` invokes the same smoke runner with `--packaged`, loading the real
`release\win-unpacked\resources\app.asar` bundle. It repeats the same native PTY, isolated provider,
settings/filesystem/Git, and HTTP(S)-blocked offline UI checks with a newly generated home.
It produces `reports\packaged-smoke.json` and `reports\packaged-smoke.png`, with `packaged: true`
in the JSON report, and cleans the generated home after the run.
It requires packaging first and does not exercise the installer or a published executable's startup.
`release` only promotes the output after `pack` and both smoke gates succeed.

## Dependency maintenance

The confirmed stable Electron/build-tool ranges are recorded in the
[architecture toolchain table](ARCHITECTURE.md#runtime-and-build-toolchain), with exact resolution
in [package-lock.json](package-lock.json). The React 18, xterm, and Monaco API integrations were
not migrated as part of this refresh. Prefer deliberate compatible/stable updates; do not use
prereleases or `npm audit fix --force` merely to reduce an audit count.

The manifest intentionally contains this **scoped** override:

```json
{
  "overrides": {
    "monaco-editor": {
      "dompurify": "^3.4.15"
    }
  }
}
```

Monaco's vulnerable pinned transitive DOMPurify dependency remained after ordinary compatible
`npm audit fix` updates. The override selects the patched range only below `monaco-editor`, rather
than forcing a DOMPurify version on unrelated dependency subtrees.

Remove this override only after an upstream Monaco release declares a safe DOMPurify version/range:

1. Update Monaco deliberately, preserving the application's required editor APIs.
2. Remove only the Monaco-specific DOMPurify override and refresh the lockfile with the supported
   npm version. Confirm the resulting Monaco dependency subtree resolves a patched DOMPurify
   without relying on the override.
3. Review the new audit result and run `npm run validate`; use the separate Windows
   `npm run test:smoke` for native/renderer fixture verification after that build.

Do not remove the override merely because the audit is clean **with it installed**.
At the 2026-09-16 upgrade checkpoint, installation reported **0 audited vulnerabilities**, down
from 32 initially and 21 after compatible-only fixes. This is a point-in-time dependency audit,
not a guarantee of vulnerability-free code or evidence that native/packaging verification passed.

## CI definitions and owner settings

[.github/workflows/ci.yml](.github/workflows/ci.yml) defines two jobs:
**`Validate (Windows)`** on `windows-latest` and **`Validate (Linux)`** on `ubuntu-latest`.
Configured triggers are pull requests, pushes to `main`, and manual dispatch.
These are repository definitions, not evidence that a remote workflow has run.

The normal successful path is `npm ci`, followed by separate default-shell lint, formatting,
typecheck, `npm run test:ci`, and `npm run check:docs` steps, then `npm run build`,
Windows-only `npm run pack`, and `npm audit --audit-level=high`.
The current Windows workflow calls **`pack`**, not just the standalone smoke command: this includes
native smoke, local unpacked packaging with `--publish never`, and the unpacked-bundle smoke check.
It does not publish a release. Linux performs non-GUI checks and a build, **not native smoke,
packaging, or supported Linux product-runtime verification**. Windows remains the product target.

The audit threshold fails on high/critical advisories; passing it is not a zero-vulnerability
guarantee. Dependency installation and audit can access the package registry, while the fixture
checks do not need AI-provider accounts.

The workflow configures:

- Actions pinned to immutable commit SHAs, `contents: read`, and checkout credentials not persisted.
- Cancellation of older runs for the same workflow/ref and a **20-minute per-job timeout**.
- Per-step GitHub logs, JUnit/LCOV artifacts, versioned JSON receipts under `reports/validation`,
  an outcome summary, and `validation-Windows` / `validation-Linux` artifacts retained for seven days.
  Summary/artifact steps are configured with `always()`; missing, failed, or required skipped
  steps are not reported as success. Definitions do not mean hosted reports already exist.

[Security checks](.github/workflows/security.yml) separately configure CodeQL, dependency-change
review, and redacted secret scanning. [Copilot setup steps](.github/workflows/copilot-setup-steps.yml)
prepare the non-GUI agent environment without changing firewall policy or providing credentials.
See [automation contracts and limitations](docs/automation.md) before enabling or interpreting them.

[CODEOWNERS](.github/CODEOWNERS) routes every path to **@qinqingxu** and **@jelllove** during the
mirror-migration window.
[Dependabot](.github/dependabot.yml) defines weekly npm and GitHub Actions updates, each with
`open-pull-requests-limit: 5`. Npm minor/patch updates are grouped into `development-tools` and
`electron-toolchain`; GitHub Actions updates are separate, and major npm updates are not part of
those minor/patch groups. These definitions do not imply automatic approval or merge.

**Required enforcement remains an owner action after publishing.** Once the workflow has been
published and the real status contexts are available, a repository owner can configure the
appropriate branch protection/ruleset to require both `Validate (Windows)` and `Validate (Linux)`,
plus Code Owner review. Editing workflow/CODEOWNERS files does not enable those remote settings.
Do not describe checks or owner review as enforced, or CI as passing, without confirming the
corresponding settings and actual run results.

## Code boundaries

| Where                                                        | What belongs there                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [src/main](src/main)                                         | Privileged Electron lifecycle, IPC handlers, filesystem, Git, provider history, configuration and PTYs |
| [src/preload/index.ts](src/preload/index.ts)                 | Thin, typed `window.api` bridge and event subscription cleanup                                         |
| [src/renderer](src/renderer)                                 | React UI, Zustand store, terminal and editor presentation                                              |
| [src/shared/types.ts](src/shared/types.ts)                   | Shared data types and `Api` interface                                                                  |
| [src/shared/agent-commands.ts](src/shared/agent-commands.ts) | Pure agent command construction; Copilot uses `copilot`                                                |

An IPC change needs the shared `Api` type, the [main handler](src/main/ipc.ts), the
[preload bridge](src/preload/index.ts), and its renderer call sites kept in agreement.
TypeScript is not runtime validation: validate untrusted persisted/provider data at the boundary.
With `verbatimModuleSyntax` enabled in [tsconfig.json](tsconfig.json), use `import type` for
type-only imports so interfaces and annotations do not become runtime dependencies.
Keep Node/filesystem/process access out of the renderer and unsubscribe events during cleanup.
The window explicitly sets `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
Preserve those boundaries without treating them as a replacement for IPC input validation.

Preserve project-ID/tab identity, config migration behavior, and Git HEAD/index/working-tree
semantics. The Git wrapper uses literal pathspecs so filenames containing characters such as
brackets are not treated as matching patterns.
See [ARCHITECTURE.md](ARCHITECTURE.md) before changing these contracts.

## Documentation contract check

[scripts/check-docs.mjs](scripts/check-docs.mjs) provides a small deterministic guard against
**specific** documentation drift. It never runs documented commands, invokes Git, or accesses the
network. Diagnostics identify the Markdown file, line, and corrective action.

### Discovery and exclusions

The checker walks the working tree for `.md` files, case-insensitively, including hidden directories,
new directories, and untracked documents. It does not use the Git index or `.gitignore` as a document
allowlist. Active docs in `docs`, `.github`, or any new handbook directory are included.

The only excluded directory trees are:

- Directories named `node_modules` or `.git`, at any depth: dependencies and Git metadata.
- Root `out`, `dist`, `release`, `coverage`, `reports`, and `.vite`: generated build/test artifacts.
- Root `Hackathon` and `docs\superpowers`: historical presentation assets and their design/plan
  records, including commands scoped to the separate media project.

Discovery does not follow symlink files or directories. A link from an active document into an
excluded tree still has to name an existing local target; exclusions do not disable target checks.
Do not add broad exclusions for new active documentation just to pass the check.

### Checked syntax

- **Npm scripts:** literal `npm run`/`npm run-script` commands, `npm.cmd`, and npm's
  lifecycle aliases (`test`, `start`, `stop`, `restart`) must name scripts declared in the root
  manifest. Common `--silent`/`-s` flags are recognized. The checker reads inline code spans and
  unlabelled or shell-labelled fences (`sh`, `bash`, `shell`, `console`, `powershell`, `pwsh`, `ps1`,
  `cmd`, `bat`, `batch`), including simple command chains and shell prompts.
- **Source paths:** a literal inline code span beginning with `src`, `scripts`, or `tests` plus a
  path separator names a repository-root path. Both separators work. For example,
  `src/main/index.ts` and `src\main\index.ts` name the same source. Line/symbol suffixes are stripped,
  but their contents are not validated.
- **Local links:** single-line Markdown link/image destinations, reference definitions, full or
  collapsed reference links, and quoted `href`/`src` attributes on HTML `a`/`img` elements.
  Relative links resolve from the document's directory; a leading `/` means repository root.
  URL-encoded filenames are decoded. Use angle-bracket destinations for names containing spaces.
  Missing targets, undefined explicit reference labels, invalid encodings, absolute Windows paths,
  and paths escaping the repository (including via symlinks) fail.

### Intentionally not checked

- External URLs, protocol-relative URLs, and anchor/query-only destinations are distinguished from
  repository paths. No URL availability, heading anchors, source symbols, or line numbers are checked.
- HTML comments and non-shell fences such as `text`, `json`, or `typescript` are examples, not
  runnable contracts. Wildcards, `<placeholder>`, `$variable`, braces, and `...` in source-path code
  spans are not literal file references. Shell comments and quoted text printed by `echo` are not commands.
- Script syntax is literal and unquoted; variable expansion, arbitrary shell programs, and `cd`
  state are not interpreted. Document runnable fences as starting at the repository root.
  Explicit `--prefix`/`--workspace`-scoped npm commands refer to another package and are outside
  the root-manifest check. Built-in operations such as `npm ci` are not script references.
- Bare prose paths, source-tree diagrams, shortcut reference links, arbitrary HTML/Markdown syntax,
  script command bodies, and behavioral descriptions are outside this narrow parser.

For non-runnable historical/code examples, label the fence appropriately and explain its scope.
Do not disguise current runnable commands as examples to evade validation.
Malformed/unreadable manifests and filesystem errors fail rather than silently passing.
**A passing check is not complete semantic drift protection**; review architecture and behavioral
claims against the current source.

## Change checklist

- Preserve unrelated edits; inspect the working-tree diff before and after the change.
- Add a focused regression test for changed behavior and keep data/side effects in disposable fixtures.
- Run the relevant local commands and report exactly which passed, failed, or were not run.
- Update current documentation alongside changed APIs, scripts, or behavior.
- For UI/native changes, record any manual fixture-based verification separately from unit/build results.
- Do not claim a live provider, released artifact, or remote check was verified without that evidence.

A short imperative commit subject is welcome, but do not create commits, push, or alter branches
unless requested. Keep dependencies lean and changes scoped to the problem.
