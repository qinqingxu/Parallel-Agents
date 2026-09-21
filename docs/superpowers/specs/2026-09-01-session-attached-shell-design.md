# Session-Attached Shell Terminal Design

## Goal

For every opened session tab, allow opening an additional local shell terminal that follows the same session lifecycle (open, switch, close) without interrupting the existing agent terminal.

## Scope

This change adds:

- an **Agent / Shell** secondary switch inside each opened session tab;
- one extra shell terminal process per opened session, bound to that session tab;
- optional shell profile selection for the session tab (PowerShell/Bash/CMD on Windows; default login shell on macOS/Linux);
- lifecycle coupling: when the session tab closes, both agent and shell terminals close.

This change does not add more top-level tabs and does not change project/session discovery behavior.

## UX Design

Each opened session tab keeps the current top-level tab behavior. Inside terminal content, a lightweight mode switch appears:

- **Agent**: current behavior (CLI agent terminal);
- **Shell**: local command shell terminal for the same session project path.

Shell is lazy-started on first switch to Shell for that tab. Switching back to Agent keeps shell alive in background. Reopening Shell for the same tab reuses existing shell process and scrollback.

On Windows, shell profile options shown in tab context menu:

- Open Shell (PowerShell) — default;
- Open Shell (Bash);
- Open Shell (CMD).

If selected shell executable is unavailable, show a visible startup error in the Shell pane and keep Agent pane usable.

On macOS/Linux, default shell uses `$SHELL` fallback (`bash`), exposed as “Open Shell”.

## Architecture

### PTY identity model

Current PTY channels already use a string key named `projectId`. We keep IPC channel names unchanged and treat this string as a **terminal instance key**:

- Agent PTY key: `<projectId>::agent`
- Shell PTY key: `<projectId>::shell:<profile>`

This avoids wide IPC contract churn while enabling multiple PTYs per session tab.

### Main process changes

- `pty-manager.ts` adds support for explicit shell executable/args and uses existing map keyed by PTY key.
- `ipc.ts` keeps `pty:*` channel names but accepts extended spawn payload fields for shell profile selection.

### Renderer/store changes

- Store tracks per-tab active terminal mode (`agent` or `shell`).
- Store tracks per-tab chosen shell profile and whether shell has been opened at least once.
- Existing close-tab paths kill all PTY keys belonging to that tab (`::agent` and any `::shell:*` key).
- Restarting agent session only restarts the `::agent` PTY, leaving shell PTY untouched.

### UI component changes

- `TerminalTabs.tsx`:
  - adds mode switch (Agent/Shell);
  - adds shell-open actions in tab context menu;
  - routes tab close actions through multi-PTY cleanup.
- `TerminalPane.tsx`:
  - accepts a PTY key separate from logical project ID;
  - accepts optional shell launch options.

## Data Flow

1. User opens project/session tab (existing flow): Agent PTY key is created and mounted.
2. User switches to Shell or uses tab context menu shell action:
   - store marks shell mode and selected profile;
   - Shell `TerminalPane` mounts using `shell` PTY key and same `cwd`.
3. PTY data/exit events route by PTY key so Agent and Shell streams are isolated.
4. Close / Close Others / Close All:
   - compute affected tabs;
   - kill each tab’s agent key and opened shell keys;
   - clear per-tab mode/profile/opened-shell metadata.

## Error Handling

- Shell spawn failures are shown in Shell pane and do not crash tab UI.
- Unsupported shell profile on current OS is blocked in UI and validated before spawn.
- PTY kill/resize/write remain no-op safe when process already exited.

## Testing

Add/extend tests for:

- PTY key derivation and per-tab key grouping;
- tab-close state cleanup removing both agent and shell key metadata;
- preserving shell state when agent restarts in same tab;
- shell mode switching logic;
- shell profile normalization per OS.

Validation includes existing `npm test` and `npm run build`.

## Out of Scope

- persistent shell history across app restarts;
- multiple shell panes per tab simultaneously;
- attaching shell to closed/inactive historical sessions not currently opened as tabs.
