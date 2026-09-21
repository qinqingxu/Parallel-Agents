# Multi-Session Tabs Per Project Design

## Goal

Allow one project to have multiple session tabs open at the same time. Clicking a session should open that session in its own tab, and clicking it again should focus the existing tab instead of replacing another session tab from the same project.

## Scope

In scope:

- Session tabs are keyed per session, not only per project.
- Session click behavior becomes:
  - open new tab if that session is not open;
  - focus existing tab if already open.
- Existing close actions continue to work per tab (Close / Close Others / Close All).
- Existing shell-below-agent behavior remains compatible.
- After implementation, generate installer and publish it to GitHub Release.

Out of scope:

- Reworking session discovery logic.
- Changing agent launch/resume command formats.

## UX Behavior

- In the project sidebar, selecting one session no longer closes another session tab for the same project.
- Multiple tabs from the same project can coexist, each bound to a distinct session ID.
- Tab label is disambiguated as `ProjectName · SessionTitle` (fallback: short session ID).
- If a clicked session is already open, app switches to that tab immediately.

## Architecture

### 1) Tab identity model

Introduce tab keys that distinguish project-level tabs and session-level tabs:

- Project tab key: `<projectId>`
- Session tab key: `<projectId>::session:<sessionId>`

Add shared helpers to build and parse keys so all components use one format.

### 2) Store state ownership

Keep existing state maps (`tabAgent`, `pendingInitialCommand`, `tabRespawnNonce`, shell maps) keyed by tab key.

Add explicit metadata maps:

- `tabProjectId[tabKey] -> projectId`
- `tabSessionId[tabKey] -> sessionId | null`

This keeps tab lifecycle independent while still resolving project/session context correctly.

### 3) Open/focus behavior

- Add a store action for session resume that accepts `(projectId, session)` and computes a session tab key.
- If tab key already exists in `openTabs`, only activate it.
- If not, create tab state for that key with resume command as pending initial command.

## Data Flow

1. User clicks a session in `SessionList`.
2. Store computes session tab key.
3. If tab exists, set `activeTabId = tabKey`.
4. If tab does not exist:
   - append tab key to `openTabs`;
   - initialize tab/project/session mappings;
   - initialize terminal/shell state for that key;
   - let `TerminalPane` spawn using terminal keys derived from tab key.

## Error Handling

- If resume command is unavailable for an agent, no tab opens (current behavior preserved).
- If project disappears, existing guards remain (no session resume on missing project path).
- Session tab key parsing failures are treated as project-level fallback only for display, never silently for destructive operations.

## Compatibility and Cleanup

- Close/Close Others/Close All continue to kill PTYs using tab-key-derived terminal keys.
- Deleting project or missing projects closes all tabs whose `tabProjectId` matches target project ID (both project tab and session tabs).
- Shell profile/show-hide state remains per tab key.

## Testing

- Add shared key helper tests for session tab key build/parse.
- Extend tab-state tests to ensure close/cleanup works with mixed project tab + session tabs.
- Add store-level tests (or targeted pure helper coverage) for:
  - open-if-missing;
  - focus-if-existing.
- Run full `npm test` and `npm run build`.

## Release Requirement

After feature verification:

1. Build Windows installer artifact.
2. Publish/update GitHub Release with generated installer assets.
