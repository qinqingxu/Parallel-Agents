<div align="center">
  <img src="resources/app-icon.png" alt="Parallel Agents" width="120" />
  <h1>Parallel Agents</h1>
  <p><strong>CLI coding agents in one Windows desktop window.</strong></p>
  <p>
    <a href="https://github.com/jelllove/Parallel-Agents/releases"><img src="https://img.shields.io/github/v/release/jelllove/Parallel-Agents?color=0e639c&label=release" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/jelllove/Parallel-Agents?color=73c991" alt="license" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" alt="platform" />
    <img src="https://img.shields.io/badge/Electron-43.6.0-47848F?logo=electron" alt="Electron 43.6.0" />
  </p>
</div>

Parallel Agents hosts locally installed coding CLIs in real terminals, with a project/session
sidebar, file explorer, and Git panel. It does not replace the agents or supply an AI service.
Launching an agent uses that CLI's own installation, authentication, and permissions.

[Quick start](#quick-start) · [Supported agents](#supported-agents) ·
[Architecture](ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Agent guide](AGENTS.md)

## Features

- **Project and session discovery** for supported Claude Code, Codex, Copilot CLI, and Gemini CLI
  history formats, including Copilot repository/session metadata.
- **Per-session tabs backed by real PTYs**, with agent start/resume commands, remembered agent
  choices, session rename/link flows, and optional attached shell panes.
- **New project workflow** for opening folders directly or creating Git worktrees before launch.
- **Project cleanup** for deleting missing provider histories after review and acknowledgement.
- **File explorer** with create, rename, copy, move, trash, reveal, and default-application actions.
- **Git panel** for status, staging, unstaging, discarding, commits, and read-only Monaco diffs
  using locally bundled editor assets loaded on demand.
- **Configurable layout and typography**, including six column orders, saved pane sizes,
  dark/light themes, and persisted font size, family, and bold settings.
- **Automatic updates** for installed Windows builds, with explicit restart confirmation.
- **Tray lifecycle**: closing the window hides it; use the tray's Quit action to exit. F11 toggles fullscreen.

## Quick start

### Use a release

Choose a Windows asset from [Releases](https://github.com/jelllove/Parallel-Agents/releases).
For a portable archive, extract the whole directory before running `Parallel Agents.exe`; use the
installer if that is the asset provided. Available artifacts depend on the release.
Versions before 0.1.10 do not include automatic updates, so install an updater-enabled build
manually once before relying on in-app checks.

### Develop from source

Use **Windows x64**, **Node.js 24**, **npm 11**, and **Git on PATH**.
[.node-version](.node-version) pins **24.17.0** for reproducible setup; the compatible engine ranges
in [package.json](package.json) are Node `^24.17.0` and npm `>=11 <12`.
The desktop runtime is **Electron 43** (`^43.6.0`), separate from the Node installation used for
development tooling.

From PowerShell:

```powershell
git clone https://github.com/jelllove/Parallel-Agents.git
Set-Location .\Parallel-Agents
npm ci
npm run dev
```

Dependency installation may download Electron and native packages. Standard Windows x64 installation
and packaging use the official N-API prebuilds shipped with `node-pty` 1.2.0-beta.13, including
`win32-x64`; a local C++ compiler is not required for this path. Windows Build Tools and matching
Spectre libraries are only prerequisites for an explicit `npm run rebuild` or other source build.
See [native-terminal troubleshooting](CONTRIBUTING.md#native-terminal-troubleshooting); do not
modify system tools or disable Spectre mitigations to make ordinary packaging succeed.

The running app reads your local provider history and settings. Use disposable projects and an
isolated test profile for destructive/manual testing, not your real session history.

For repeatable onboarding, `npm run doctor` reports prerequisites and `npm run setup` performs
the explicit locked installation/check sequence. A native PowerShell entry point, versioned VS Code
tasks, and an optional non-GUI container are described in the
[development environment guide](docs/development-environment.md). None installs hooks or global tools.

### Local validation

```powershell
npm run check
npm run build
```

`check` runs lint, formatting verification, TypeScript checking, local tests, the documentation
contract check, and the agent instruction corpus check. `build` type-checks and produces the Electron bundles in `out`.
`npm run validate` combines both. These checks do not require AI provider credentials or make live
agent requests; passing them does not prove native terminal behavior or provider compatibility.
Optional `npm run test:coverage` adds Node's built-in coverage reporting for modules loaded by the
tests, not whole-repository or native-runtime coverage.
The complete command reference and targeted test workflow are in [CONTRIBUTING.md](CONTRIBUTING.md#local-commands).

`npm run test:ci` adds JUnit/LCOV artifacts, and `npm run test:e2e` is the conventional alias for
the existing Windows native smoke. Optional hook setup starts as a preview and requires explicit
opt-in; security and agent-environment workflows remain separate from application behavior.
See the [engineering automation guide](docs/automation.md) for receipts, prerequisites, and
the distinction between configured workflows and actual hosted enforcement.

For Windows-only native integration checks, run `npm run test:smoke` **after `npm run build`**.
It launches real Electron and a native command-shell PTY with generated disposable data and inert
AI-provider CLI shims, not real agent CLIs or provider accounts. The fixture selects its generated
Claude project in the UI and opens a diff with HTTP(S) blocked in the test window's Electron session,
asserting that both revisions render offline. It is separate from both `check` and `validate`.
See the [native smoke procedure](CONTRIBUTING.md#windows-native-smoke-test) for prerequisites,
scope, and the generated `reports\smoke.json` and `reports\smoke.png` artifacts.

## Supported agents

| Agent              | Executable | History discovered by this app                                                     |
| ------------------ | ---------- | ---------------------------------------------------------------------------------- |
| GitHub Copilot CLI | `copilot`  | `$HOME\.copilot\session-state\<session>\events.jsonl`                              |
| Claude Code        | `claude`   | `$HOME\.claude\projects\<project>\*.jsonl`                                         |
| Gemini CLI         | `gemini`   | `$HOME\.gemini\tmp\<project>\chats\*.jsonl`, with `.project_root` project metadata |
| Codex CLI          | `codex`    | `$HOME\.codex\sessions\**\*.jsonl` plus `session_index.jsonl` titles               |
| Aider              | `aider`    | No automatic history scan; launch/restore command support                          |

The Copilot executable is standalone **`copilot`**, not a GitHub CLI subcommand.
[Provider definitions](src/main/agent-providers.ts) describe binary detection and installation links;
[shared command builders](src/shared/agent-commands.ts) define launch/resume syntax.
The missing-CLI banner opens installation guidance rather than installing tools for you.
Provider log formats may change; detection is limited to the formats the current readers support.

## Architecture

| Boundary                                | Responsibility                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Main](src/main/index.ts)               | Electron lifecycle, IPC handlers, provider history, filesystem, Git, configuration, PTYs |
| [Preload](src/preload/index.ts)         | Typed `window.api` bridge from renderer to main                                          |
| [Renderer](src/renderer/App.tsx)        | React UI, Zustand application state, xterm terminals, local Monaco editor bundle         |
| [Shared contracts](src/shared/types.ts) | API and data types used across the boundaries                                            |

The current window explicitly enables `sandbox` and `contextIsolation` and disables
`nodeIntegration`. These process boundaries do not replace validation of privileged IPC inputs.
See [ARCHITECTURE.md](ARCHITECTURE.md) for IPC contracts, data flows, and persistence details.
The [runtime and build toolchain](ARCHITECTURE.md#runtime-and-build-toolchain) records the confirmed
baseline; the manifest and lockfile remain authoritative for dependency ranges and resolved versions.
The [offline diff loader](ARCHITECTURE.md#offline-diff-loading) lazy-loads local Monaco and worker
assets instead of fetching the editor from a CDN. This concerns the diff viewer, not the network
requirements of whichever external coding agent you choose to run.

## User data and destructive actions

App settings live at `$HOME\.claude\parallel-agents.json`. They include pinned/hidden projects,
remembered agents, project order, main-pane layout, theme, and terminal/tab preferences.
The Explorer/Git vertical splitter also uses Chromium local storage. Agent histories and files in
your selected projects are separate data, not contents of the settings file.

- **Hide** changes a visibility preference.
- **Delete project/session** can permanently remove provider history. This is not the Explorer's
  recycle-bin action.
- **Explorer trash**, file moves, and **Git discard/commit** operate on real selected project files.

Do not delete settings or provider directories as a routine troubleshooting step. Quit the app and
back up the relevant data before intentional recovery or migration work. Invalid existing settings
are reported rather than silently replaced; there is no automatic recovery promise.

## Demo artwork

These checked-in hackathon illustrations are historical presentation assets, **not screenshots
verifying the current build**.

| Dark presentation                                                                      | Light presentation                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ![Historical dark presentation](Hackathon/parallel-agents-dark/01-poster-overview.png) | ![Historical light presentation](Hackathon/parallel-agents-light/01-poster-overview.png) |

## Packaging

Packaging is optional for normal development. `npm run pack` requests a local unpacked build and
`npm run dist` requests configured distribution artifacts. Both run **build → native smoke →
electron-builder with `--publish never` → `test:packaged`**. `build.npmRebuild: false` retains the
upstream N-API prebuilds instead of recompiling them unnecessarily; native smoke gates remain required.
`test:packaged` repeats the same native/offline UI checks against the real `app.asar` bundle with a
fresh isolated home, producing `reports\packaged-smoke.json` and `reports\packaged-smoke.png`.
Script wiring is not evidence of a successful run or installer verification.

`npm run release` is local packaging and promotion, **not network publishing**. It additionally
replaces the existing `release\latest` directory via
[the promotion script](scripts/promote-latest.cjs). Only run it when you intend to replace those
local artifacts. `pack` and `dist` explicitly retain `--publish never`; packaging may still need
dependency/tool downloads even though publishing is disabled.

## Contributing and project intent

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, local checks, and the bounded documentation checker.
[AGENTS.md](AGENTS.md) is the shared guide for coding agents. Changes should preserve existing user
data and unrelated working-tree edits.

The [CI definitions](.github/workflows/ci.yml) configure Windows and Linux validation jobs.
Linux covers non-GUI checks/builds, not a supported desktop runtime. Workflow and CODEOWNERS files
are not evidence that CI ran or that required reviews/checks are enforced; those settings remain
an owner action after publishing. See [CI boundaries](CONTRIBUTING.md#ci-definitions-and-owner-settings).

[SPEC.md](SPEC.md) records product intent, including historical descriptions; use current source
and [ARCHITECTURE.md](ARCHITECTURE.md) for implemented behavior.
Discuss larger changes in [issues](https://github.com/jelllove/Parallel-Agents/issues).
For security reports, follow [SECURITY.md](SECURITY.md), not a public issue.
Contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © [jelllove](https://github.com/jelllove).
