# Session Shell Below Agent With Show/Hide Design

## Goal

Adjust the session-attached shell UX so the shell lives below the session agent CLI in the same tab and can be shown or hidden without losing its process state.

## Scope

This refinement changes only in-tab terminal presentation and visibility behavior:

- Agent terminal remains the primary pane on top.
- Shell terminal is docked below as a secondary pane.
- Shell pane is hidden by default.
- Show/Hide controls toggle shell pane visibility.
- Hiding shell does not kill its process.

Existing project/session discovery and top-level tab behavior remain unchanged.

## UX Behavior

- For each opened session tab, terminal area becomes a vertical stack.
- Agent pane is always visible when the tab is active.
- Shell pane appears underneath when shown.
- First Show action lazily creates the shell PTY.
- Hide collapses the shell pane while keeping PTY alive.
- Show again restores the existing shell process and buffer.

Shell profile actions in tab context menu remain:

- Windows: Open Shell (PowerShell), Open Shell (Bash), Open Shell (CMD).
- Non-Windows: Open Shell.

Selecting a different profile recreates only the shell PTY and keeps the agent terminal untouched.

## Architecture Updates

- Reuse existing PTY key model:
  - `<projectId>::agent`
  - `<projectId>::shell:<profile>`
- Keep shell lifecycle state in store (`opened/profile`) and add explicit shell visibility state per tab.
- Close, Close Others, Close All continue to clean both PTY keys and related tab shell state.

## Data Flow

1. Open tab: agent PTY starts; shell remains unopened and hidden.
2. Show shell:
   - mark shell visible;
   - if unopened, create shell PTY with selected/default profile.
3. Hide shell:
   - mark shell hidden only;
   - keep shell PTY running.
4. Close tab:
   - kill agent and shell PTY keys;
   - clear all tab shell state.

## Error Handling

- Shell spawn failure is shown in shell pane and does not impact agent pane.
- Invalid shell profile requests are rejected before spawn.
- Hide/show toggles are no-op-safe if tab is not open.

## Testing

- Add/extend pure helper tests for shell visibility state transitions.
- Keep existing PTY key cleanup tests passing.
- Run full `npm test` and `npm run build`.
