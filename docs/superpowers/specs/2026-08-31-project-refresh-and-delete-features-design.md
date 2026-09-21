# Project Refresh and Delete Features Design

## Goal

Improve project inventory reliability and make stale projects and terminal tabs faster to clean up without increasing the risk of deleting active project history.

## Scope

This change will:

- change automatic project and agent refresh from one minute to ten minutes;
- add multi-select deletion and delete-all for projects whose working directory no longer exists;
- add Close Others and Close All to every terminal tab;
- prevent a transient Copilot session scan failure from replacing a populated project list with zero projects;
- surface refresh and bulk-delete failures while retaining the last valid UI state.

The term "deleted project" means an existing project-history entry whose `Project.exists` value is `false`. Deleting such an entry removes only the agent's session-history metadata. It never deletes the working directory.

## Project Inventory Refresh

The renderer will continue to refresh immediately at startup and on manual request. The periodic refresh interval will change to ten minutes.

The main-process project scanner will retain the most recent successful Copilot project snapshot. A scan is successful when:

- the Copilot session-state root does not exist or contains no candidate session event files, which is a legitimate empty inventory; or
- at least one candidate event file is parsed successfully.

If candidate event files exist but none can be parsed during a refresh, the scan is considered transiently invalid. The scanner will return the last successful Copilot snapshot instead of an empty list. Valid sessions remain usable even when individual session files are malformed or temporarily being written.

The renderer will update project state only after a project-list request succeeds. A failed refresh keeps the current project list and sets a visible inventory error that the user can retry through the existing refresh button.

## Deleted Project Cleanup

The project list will expose a cleanup action when at least one project has `exists === false`. Activating cleanup mode adds checkboxes only to these missing projects. Normal projects cannot be selected for bulk deletion.

Cleanup mode supports:

- selecting or clearing individual missing projects;
- deleting the selected missing projects;
- deleting all currently missing projects;
- cancelling cleanup mode without making changes.

Both destructive actions use one confirmation dialog describing the number of history entries to be removed. The main process will re-scan and validate every requested ID immediately before deletion. It will reject IDs that are unsupported, unknown, or no longer missing. This prevents stale renderer state from broadening the deletion target.

A new bulk-delete IPC method will own validation and deletion. On success, the renderer will close affected tabs and PTYs, clear affected selections and cached sessions, and reload projects once. On failure, the error is shown and the list is refreshed so that partial filesystem changes cannot leave the UI stale.

Existing context-menu deletion remains available for a single Claude, Gemini, or Copilot project and keeps its current typed confirmation.

## Terminal Tab Actions

Every terminal tab will have a context menu with:

- Close;
- Close Others;
- Close All.

Close Others keeps the clicked tab active and closes every other tab. Close All closes every tab and leaves no active tab. Closing multiple tabs kills each associated PTY, removes ad-hoc project entries belonging to closed tabs, and clears tab-specific agent state.

When close confirmation is enabled, a multi-tab operation displays one aggregate confirmation rather than one dialog per tab. Cancelling leaves every tab and PTY unchanged.

The store will expose a single multi-tab close operation. The existing single-tab close path will use the same state-transition helper so active-tab selection and cleanup behavior remain consistent.

## Components and Interfaces

### Main Process

- `projects.ts` will distinguish valid empty Copilot scans from invalid all-failed scans and maintain the last valid Copilot snapshot.
- `projects.ts` will add validated bulk deletion for missing projects.
- `ipc.ts` will register the bulk-delete channel.

### Shared and Preload

- `Api.projects` will expose the bulk-delete operation.
- The preload bridge will map the method to the new IPC channel.

### Renderer Store

- inventory refresh errors will be represented explicitly;
- bulk project deletion will centralize tab, PTY, session, and selection cleanup;
- multi-tab close will centralize state cleanup and active-tab selection.

### Renderer Components

- `ProjectList` will own cleanup-mode selection and confirmation UI;
- `Sidebar` will display inventory errors near the refresh action;
- `TerminalTabs` will own the per-tab context menu and aggregate close confirmation;
- existing dialog styling and interaction patterns will be reused.

## Error Handling

- Project refresh failures preserve the last rendered inventory and show an actionable error.
- A transient invalid Copilot scan preserves only the last successful Copilot snapshot; it does not fabricate projects when no snapshot exists.
- Bulk deletion validates the entire request before deleting any entry.
- Filesystem deletion errors propagate to the renderer and are displayed.
- UI state is reconciled by refreshing after a failed bulk operation.

## Testing

Automated tests will cover:

- Copilot scanning with valid sessions;
- a populated Copilot snapshot followed by an all-failed transient scan;
- a legitimate empty Copilot session directory;
- mixed valid and malformed Copilot session files;
- bulk deletion rejecting normal or unsupported projects;
- Close Others and Close All state transitions, including active-tab selection;
- the ten-minute refresh interval through an exported constant or equivalent testable boundary.

Validation will run the existing test suite and production build. Manual verification will cover missing-project selection, delete selected, delete all, aggregate confirmation, tab context menus, and retained Copilot inventory after a simulated scan failure.

## Out of Scope

- filesystem watchers or real-time project inventory updates;
- bulk deletion of projects whose working directory still exists;
- deleting actual working directories;
- adding project deletion support for agents that do not currently support it.
