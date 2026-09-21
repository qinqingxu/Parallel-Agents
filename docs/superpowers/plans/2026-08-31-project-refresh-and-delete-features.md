# Project Refresh and Delete Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable ten-minute inventory refresh, safe bulk cleanup for missing projects, and Close Others/Close All actions for terminal tabs.

**Architecture:** Keep filesystem authority in the Electron main process and expose one validated bulk-delete IPC method. Add small pure policy helpers for Copilot snapshot stabilization and tab state transitions so the failure-prone behavior can be tested with the existing Node test runner, while React components remain thin interaction layers.

**Tech Stack:** Electron 32, TypeScript, React 18, Zustand, Node test runner, electron-vite.

---

## File Structure

- Create `src/shared/constants.ts`: shared, testable inventory refresh interval.
- Create `src/main/project-policies.ts`: pure Copilot snapshot and bulk-delete validation policies.
- Create `src/renderer/store/tab-state.ts`: pure multi-tab close state transition.
- Create `tests/project-policies.test.mjs`: regression coverage for Copilot and deletion policies.
- Create `tests/tab-state.test.mjs`: Close, Close Others, and Close All transition coverage.
- Create `tests/constants.test.mjs`: verifies the ten-minute interval.
- Modify `src/main/projects.ts`: collect Copilot scan diagnostics, retain the last valid snapshot, and implement validated bulk deletion.
- Modify `src/main/ipc.ts`: register bulk project deletion.
- Modify `src/shared/types.ts`: expose bulk deletion through `Api`.
- Modify `src/preload/index.ts`: bridge bulk deletion.
- Modify `src/renderer/store/app-store.ts`: preserve inventory on errors, expose errors, bulk-delete projects, and close groups of tabs.
- Modify `src/renderer/components/Sidebar.tsx`: display refresh errors.
- Modify `src/renderer/components/ProjectList.tsx`: add missing-project cleanup mode and aggregate confirmation.
- Modify `src/renderer/components/TerminalTabs.tsx`: add per-tab context menu and aggregate close confirmation.
- Modify `src/renderer/components/CloseTabConfirmDialog.tsx`: support single- and multi-tab confirmation copy.
- Modify `src/renderer/styles/theme.css`: style cleanup controls, error text, checkboxes, and tab context menu.
- Modify `src/renderer/App.tsx`: use the ten-minute refresh constant.

### Task 1: Ten-Minute Refresh Boundary

**Files:**
- Create: `src/shared/constants.ts`
- Create: `tests/constants.test.mjs`
- Modify: `src/renderer/App.tsx:14,52-57`

- [ ] **Step 1: Write the failing interval test**

```js
// tests/constants.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { INVENTORY_AUTO_REFRESH_MS } from '../src/shared/constants.ts';

test('automatically refreshes inventory every ten minutes', () => {
  assert.equal(INVENTORY_AUTO_REFRESH_MS, 10 * 60 * 1000);
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/constants.test.mjs`

Expected: FAIL because `src/shared/constants.ts` does not exist.

- [ ] **Step 3: Add the shared constant and consume it**

```ts
// src/shared/constants.ts
export const INVENTORY_AUTO_REFRESH_MS = 10 * 60 * 1000;
```

In `src/renderer/App.tsx`, import the constant and remove the local one-minute declaration:

```ts
import { INVENTORY_AUTO_REFRESH_MS } from '../shared/constants';
```

Keep the existing startup refresh and `setInterval` effect unchanged apart from its constant source.

- [ ] **Step 4: Run the targeted test**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/constants.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/shared/constants.ts src/renderer/App.tsx tests/constants.test.mjs
git commit -m "fix: refresh project inventory every ten minutes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Stable Copilot Inventory Snapshots

**Files:**
- Create: `src/main/project-policies.ts`
- Create: `tests/project-policies.test.mjs`
- Modify: `src/main/projects.ts:79-140,252-351`

- [ ] **Step 1: Write failing snapshot-policy tests**

```js
// tests/project-policies.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stabilizeCopilotProjects,
} from '../src/main/project-policies.ts';

const project = (id, exists = false, agent = 'copilot') => ({
  id,
  agent,
  dirName: id.slice(id.indexOf(':') + 1),
  realPath: `C:\\work\\${id}`,
  displayName: id,
  exists,
  pinned: false,
  hidden: false,
  sessionCount: 1,
  lastActivity: 1,
});

test('keeps the previous Copilot snapshot when every candidate fails', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  const result = stabilizeCopilotProjects(previous, {
    projects: [],
    valid: true,
    candidateCount: 3,
    parsedCount: 0,
  });
  assert.deepEqual(result, previous);
});

test('accepts a legitimate empty Copilot inventory', () => {
  assert.deepEqual(stabilizeCopilotProjects([project('copilot:old')], {
    projects: [],
    valid: true,
    candidateCount: 0,
    parsedCount: 0,
  }), []);
});

test('accepts valid projects while ignoring malformed candidates', () => {
  const current = [project('copilot:C:\\work\\beta')];
  assert.deepEqual(stabilizeCopilotProjects([], {
    projects: current,
    valid: true,
    candidateCount: 2,
    parsedCount: 1,
  }), current);
});

test('keeps the previous snapshot when the Copilot root is temporarily unreadable', () => {
  const previous = [project('copilot:C:\\work\\alpha')];
  assert.deepEqual(stabilizeCopilotProjects(previous, {
    projects: [],
    valid: false,
    candidateCount: 0,
    parsedCount: 0,
  }), previous);
});
```

- [ ] **Step 2: Run the policy tests and verify they fail**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/project-policies.test.mjs`

Expected: FAIL because `project-policies.ts` does not exist.

- [ ] **Step 3: Implement the pure Copilot scan policy**

```ts
// src/main/project-policies.ts
import type { Project } from '../shared/types';

export interface CopilotScanResult {
  projects: Project[];
  valid: boolean;
  candidateCount: number;
  parsedCount: number;
}

export function stabilizeCopilotProjects(
  previous: Project[],
  scan: CopilotScanResult,
): Project[] {
  if (!scan.valid || (scan.candidateCount > 0 && scan.parsedCount === 0)) return previous;
  return scan.projects;
}

export function removeProjectsFromSnapshot(snapshot: Project[], ids: string[]): Project[] {
  const removed = new Set(ids);
  return snapshot.filter((project) => !removed.has(project.id));
}
```

- [ ] **Step 4: Return diagnostics from the Copilot scanner**

Change `listCopilotProjects` in `src/main/projects.ts` to return `CopilotScanResult`. Increment `candidateCount` only after confirming `events.jsonl` is a file, and increment `parsedCount` after `readCopilotSessionStart` returns metadata:

```ts
let candidateCount = 0;
let parsedCount = 0;
// ...
candidateCount++;
const meta = await readCopilotSessionStart(eventsPath);
if (!meta) continue;
parsedCount++;
// ...
return { projects: out, valid: true, candidateCount, parsedCount };
```

Keep a module-level snapshot and stabilize each completed scan:

```ts
let lastSuccessfulCopilotProjects: Project[] = [];

const copilotScan = await listCopilotProjects(pinned, hidden);
const copilot = stabilizeCopilotProjects(lastSuccessfulCopilotProjects, copilotScan);
if (copilotScan.valid && (copilotScan.candidateCount === 0 || copilotScan.parsedCount > 0)) {
  lastSuccessfulCopilotProjects = copilot;
}
```

Run Claude, Gemini, and Copilot scans concurrently, then apply the policy before sorting the combined list.

- [ ] **Step 5: Run the targeted tests**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/project-policies.test.mjs`

Expected: all snapshot-policy tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/main/project-policies.ts src/main/projects.ts tests/project-policies.test.mjs
git commit -m "fix: retain Copilot projects after transient scan failures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Validated Bulk Deletion in the Main Process

**Files:**
- Modify: `src/main/project-policies.ts`
- Modify: `tests/project-policies.test.mjs`
- Modify: `src/main/projects.ts:354-385`
- Modify: `src/main/ipc.ts:25-44`
- Modify: `src/shared/types.ts:101-108`
- Modify: `src/preload/index.ts:5-11`

- [ ] **Step 1: Add failing bulk-validation tests**

Extend the existing policy import with `validateMissingProjectIds`, then append the tests:

```js
import {
  stabilizeCopilotProjects,
  validateMissingProjectIds,
} from '../src/main/project-policies.ts';

test('validates a unique set of missing deletable projects', () => {
  const a = project('copilot:C:\\work\\gone-a');
  const b = project('claude:C--work-gone-b', false, 'claude');
  assert.deepEqual(validateMissingProjectIds([a, b], [a.id, b.id, a.id]), [a, b]);
});

test('rejects bulk deletion when a working directory still exists', () => {
  const active = project('copilot:C:\\work\\active', true);
  assert.throws(
    () => validateMissingProjectIds([active], [active.id]),
    /not missing/,
  );
});

test('rejects unknown and unsupported projects', () => {
  const codex = project('codex:C:\\work\\gone', false, 'codex');
  assert.throws(
    () => validateMissingProjectIds([codex], [codex.id]),
    /not supported/,
  );
  assert.throws(
    () => validateMissingProjectIds([], ['copilot:unknown']),
    /Unknown project/,
  );
});
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/project-policies.test.mjs`

Expected: FAIL because `validateMissingProjectIds` is not exported.

- [ ] **Step 3: Implement all-before-any validation**

Add to `src/main/project-policies.ts`:

```ts
const DELETABLE_AGENTS = new Set(['claude', 'gemini', 'copilot']);

export function validateMissingProjectIds(
  projects: Project[],
  ids: string[],
): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return [...new Set(ids)].map((id) => {
    const project = byId.get(id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    if (!DELETABLE_AGENTS.has(project.agent)) {
      throw new Error(`Delete not supported for agent: ${project.agent}`);
    }
    if (project.exists) throw new Error(`Project is not missing: ${id}`);
    return project;
  });
}
```

- [ ] **Step 4: Add the bulk main-process operation**

Refactor the current deletion body into an internal `deleteProjectHistory(projectId)` helper that performs filesystem deletion but does not call `forgetProject`.
After a successful history deletion, remove that project ID from `lastSuccessfulCopilotProjects` with `removeProjectsFromSnapshot` before saving config. This prevents a retained fallback snapshot from resurrecting a project the user just deleted.

Add:

```ts
export async function deleteMissingProjects(projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) throw new Error('No projects selected');
  const projects = await listProjects();
  const targets = validateMissingProjectIds(projects, projectIds);
  for (const project of targets) {
    await deleteProjectHistory(project.id);
    await forgetProject(project.id);
  }
}
```

Keep `deleteProject` behavior unchanged by making it call the same helper and then `forgetProject`.

- [ ] **Step 5: Wire the IPC contract**

In `src/shared/types.ts`:

```ts
deleteMissing(ids: string[]): Promise<void>;
```

In `src/preload/index.ts`:

```ts
deleteMissing: (ids) => ipcRenderer.invoke('projects:deleteMissing', ids),
```

In `src/main/ipc.ts`:

```ts
ipcMain.handle('projects:deleteMissing', (_e, ids: string[]) =>
  deleteMissingProjects(ids),
);
```

Import `deleteMissingProjects` alongside the existing project functions.

- [ ] **Step 6: Run policy tests and build**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Electron main, preload, and renderer builds succeed with no TypeScript errors.

- [ ] **Step 7: Commit**

```powershell
git add src/main/project-policies.ts src/main/projects.ts src/main/ipc.ts src/shared/types.ts src/preload/index.ts tests/project-policies.test.mjs
git commit -m "feat: add safe bulk cleanup for missing projects" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Inventory Errors and Bulk Cleanup Store Action

**Files:**
- Modify: `src/renderer/store/app-store.ts:15-76,100-163,238-302`
- Modify: `src/renderer/components/Sidebar.tsx:14-71`
- Modify: `src/renderer/styles/theme.css`

- [ ] **Step 1: Add explicit store state and actions**

Extend `AppState`:

```ts
inventoryError: string | null;
deleteMissingProjects: (ids: string[]) => Promise<void>;
```

Initialize `inventoryError` to `null`.

- [ ] **Step 2: Preserve inventory and surface refresh failures**

Update `refreshProjectsAndAgents`:

```ts
set({ inventoryRefreshing: true, inventoryError: null });
try {
  await Promise.all([
    get().loadProjects(),
    get().loadAgents(),
    get().checkAgents(),
  ]);
  const selectedId = get().selectedProjectId;
  if (!selectedId) return;
  const project = get().findProject(selectedId);
  if (project && !project.dirName.startsWith('adhoc:')) {
    await get().loadSessions(selectedId);
  }
  if (project?.exists) {
    await get().loadGitStatus(project.realPath);
  }
} catch (error) {
  set({
    inventoryError: error instanceof Error ? error.message : String(error),
  });
} finally {
  set({ inventoryRefreshing: false });
}
```

`loadProjects` already waits for a successful response before calling `set`, so the previous project list remains intact on rejection.

- [ ] **Step 3: Implement bulk deletion and reconcile related UI state**

```ts
async deleteMissingProjects(ids) {
  try {
    await window.api.projects.deleteMissing(ids);
    const { openTabs, activeTabId, adhocProjects, tabAgent } = get();
    const closing = new Set(ids);
    const nextOpenTabs = openTabs.filter((id) => !closing.has(id));
    let nextActiveTabId = activeTabId;
    if (activeTabId && closing.has(activeTabId)) {
      const activeIndex = openTabs.indexOf(activeTabId);
      nextActiveTabId = nextOpenTabs.find((id) => openTabs.indexOf(id) > activeIndex)
        ?? [...nextOpenTabs].reverse().find((id) => openTabs.indexOf(id) < activeIndex)
        ?? null;
    }
    for (const id of ids) {
      if (openTabs.includes(id)) void window.api.pty.kill(id);
    }
    const nextTabAgent = { ...tabAgent };
    for (const id of ids) delete nextTabAgent[id];
    const nextSessions = { ...get().sessions };
    for (const id of ids) delete nextSessions[id];
    set({
      openTabs: nextOpenTabs,
      activeTabId: nextActiveTabId,
      adhocProjects: adhocProjects.filter((project) => !closing.has(project.id)),
      tabAgent: nextTabAgent,
      sessions: nextSessions,
      selectedProjectId: ids.includes(get().selectedProjectId ?? '')
        ? null
        : get().selectedProjectId,
      inventoryError: null,
    });
  } catch (error) {
    set({
      inventoryError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await get().loadProjects().catch((error) => {
      set({ inventoryError: error instanceof Error ? error.message : String(error) });
    });
  }
}
```

The component will catch the rethrown error only to keep its dialog open/selection intact; the store owns user-visible error state.

- [ ] **Step 4: Render a retryable inventory error**

Read `inventoryError` in `Sidebar`. Directly below the refresh button, render:

```tsx
{inventoryError && (
  <div className="inventory-error" role="alert" title={inventoryError}>
    Inventory action failed: {inventoryError}
  </div>
)}
```

Add compact wrapping red text styles in `theme.css`.

- [ ] **Step 5: Build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/store/app-store.ts src/renderer/components/Sidebar.tsx src/renderer/styles/theme.css
git commit -m "feat: surface inventory refresh failures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Missing Project Cleanup UI

**Files:**
- Modify: `src/renderer/components/ProjectList.tsx:27-243`
- Modify: `src/renderer/styles/theme.css`

- [ ] **Step 1: Add cleanup-mode state and derived values**

In `ProjectList`, read `deleteMissingProjects` from the store and add:

```ts
const [cleanupMode, setCleanupMode] = useState(false);
const [selectedMissingIds, setSelectedMissingIds] = useState<string[]>([]);
const [confirmBulkIds, setConfirmBulkIds] = useState<string[] | null>(null);
const missingProjects = useMemo(
  () => projects.filter((project) => !project.exists && canDeleteProject(project.agent)),
  [projects],
);
```

When `projects` changes, remove IDs that are no longer missing:

```ts
useEffect(() => {
  const valid = new Set(missingProjects.map((project) => project.id));
  setSelectedMissingIds((ids) => ids.filter((id) => valid.has(id)));
  if (missingProjects.length === 0) setCleanupMode(false);
}, [missingProjects]);
```

- [ ] **Step 2: Add cleanup controls**

Above the agent groups, render controls only when missing entries exist:

```tsx
{missingProjects.length > 0 && (
  <div className="project-cleanup-bar">
    {!cleanupMode ? (
      <button className="btn-secondary" onClick={() => setCleanupMode(true)}>
        Clean deleted projects ({missingProjects.length})
      </button>
    ) : (
      <>
        <button
          className="btn-danger"
          disabled={selectedMissingIds.length === 0}
          onClick={() => setConfirmBulkIds(selectedMissingIds)}
        >
          Delete selected ({selectedMissingIds.length})
        </button>
        <button
          className="btn-danger"
          onClick={() => setConfirmBulkIds(missingProjects.map((project) => project.id))}
        >
          Delete all deleted
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setCleanupMode(false);
            setSelectedMissingIds([]);
          }}
        >
          Cancel
        </button>
      </>
    )}
  </div>
)}
```

- [ ] **Step 3: Add missing-project checkboxes without opening projects**

At the start of each project row, render a checkbox only for eligible missing projects:

```tsx
{cleanupMode && !p.exists && canDeleteProject(p.agent) && (
  <input
    type="checkbox"
    className="project-cleanup-check"
    checked={selectedMissingIds.includes(p.id)}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => {
      setSelectedMissingIds((ids) =>
        event.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
      );
    }}
    aria-label={`Select ${p.displayName} for deletion`}
  />
)}
```

Disable row dragging while in cleanup mode.

- [ ] **Step 4: Add one aggregate destructive confirmation**

Reuse `ConfirmDialog` with an explicit phrase rather than a project name:

```tsx
{confirmBulkIds && (
  <ConfirmDialog
    title={`Delete ${confirmBulkIds.length} deleted project histories?`}
    message="This permanently removes the selected agent session histories. Working directories are not touched."
    confirmText="Delete forever"
    typeToConfirm="DELETE"
    destructive
    onConfirm={async () => {
      const ids = confirmBulkIds;
      try {
        await deleteMissingProjects(ids);
        setConfirmBulkIds(null);
        setSelectedMissingIds([]);
      } catch {
        // The store displays the error and the dialog remains available to retry or cancel.
      }
    }}
    onCancel={() => setConfirmBulkIds(null)}
  />
)}
```

- [ ] **Step 5: Style and build**

Add `.project-cleanup-bar` as a wrapping flex row, keep buttons compact, and prevent `.project-cleanup-check` from shrinking.

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/components/ProjectList.tsx src/renderer/styles/theme.css
git commit -m "feat: add quick cleanup for deleted projects" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Close Others and Close All

**Files:**
- Create: `src/renderer/store/tab-state.ts`
- Create: `tests/tab-state.test.mjs`
- Modify: `src/renderer/store/app-store.ts:48-50,238-255`
- Modify: `src/renderer/components/TerminalTabs.tsx`
- Modify: `src/renderer/components/CloseTabConfirmDialog.tsx`
- Modify: `src/renderer/styles/theme.css`

- [ ] **Step 1: Write failing tab-transition tests**

```js
// tests/tab-state.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { closeTabIds, omitRecordKeys } from '../src/renderer/store/tab-state.ts';

test('closing other tabs keeps the target active', () => {
  assert.deepEqual(
    closeTabIds(['a', 'b', 'c'], 'a', ['a', 'c']),
    { openTabs: ['b'], activeTabId: 'b' },
  );
});

test('closing all tabs clears the active tab', () => {
  assert.deepEqual(
    closeTabIds(['a', 'b'], 'b', ['a', 'b']),
    { openTabs: [], activeTabId: null },
  );
});

test('closing an active tab selects its next neighbor', () => {
  assert.deepEqual(
    closeTabIds(['a', 'b', 'c'], 'b', ['b']),
    { openTabs: ['a', 'c'], activeTabId: 'c' },
  );
});

test('removes closed tab keys from tab-specific state', () => {
  assert.deepEqual(omitRecordKeys({ a: 1, b: 2 }, ['a']), { b: 2 });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/tab-state.test.mjs`

Expected: FAIL because `tab-state.ts` does not exist.

- [ ] **Step 3: Implement the pure transition**

```ts
// src/renderer/store/tab-state.ts
export interface TabState {
  openTabs: string[];
  activeTabId: string | null;
}

export function omitRecordKeys<T>(
  record: Record<string, T>,
  keys: string[],
): Record<string, T> {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

export function closeTabIds(
  openTabs: string[],
  activeTabId: string | null,
  ids: string[],
): TabState {
  const closing = new Set(ids);
  const next = openTabs.filter((id) => !closing.has(id));
  if (!activeTabId || !closing.has(activeTabId)) {
    return { openTabs: next, activeTabId };
  }
  const activeIndex = openTabs.indexOf(activeTabId);
  return {
    openTabs: next,
    activeTabId: next.find((id) => openTabs.indexOf(id) > activeIndex)
      ?? [...next].reverse().find((id) => openTabs.indexOf(id) < activeIndex)
      ?? null,
  };
}
```

- [ ] **Step 4: Centralize store cleanup**

Import `closeTabIds` and `omitRecordKeys` from `./tab-state`. Add `closeTabs: (ids: string[]) => void` to `AppState`, then implement it:

```ts
closeTabs(ids) {
  const uniqueIds = [...new Set(ids)];
  const {
    openTabs,
    activeTabId,
    adhocProjects,
    tabAgent,
    pendingInitialCommand,
    tabRespawnNonce,
  } = get();
  const nextTabs = closeTabIds(openTabs, activeTabId, uniqueIds);
  for (const id of uniqueIds) void window.api.pty.kill(id);
  set({
    ...nextTabs,
    adhocProjects: adhocProjects.filter((project) => !uniqueIds.includes(project.id)),
    tabAgent: omitRecordKeys(tabAgent, uniqueIds),
    pendingInitialCommand: omitRecordKeys(pendingInitialCommand, uniqueIds),
    tabRespawnNonce: omitRecordKeys(tabRespawnNonce, uniqueIds),
  });
},

closeTab(id) {
  get().closeTabs([id]);
},
```

Replace the inline tab cleanup in `deleteMissingProjects` with `get().closeTabs(ids)`. Keep its session-cache and selected-project cleanup unchanged.

- [ ] **Step 5: Add the per-tab context menu**

In `TerminalTabs`, track:

```ts
const closeTabs = useAppStore((state) => state.closeTabs);
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
const [pendingClose, setPendingClose] = useState<{ ids: string[]; label: string } | null>(null);
```

Attach `onContextMenu` to every tab and render the existing `.ctx-menu` pattern with Close, Close Others, and Close All. Close Others computes `openTabs.filter((id) => id !== contextMenu.id)`. Disable it when there is only one tab. Route each action through a helper that either sets `pendingClose` or immediately calls `closeTabs`, depending on `confirmOnCloseTab`.

- [ ] **Step 6: Generalize aggregate confirmation copy**

Change `CloseTabConfirmDialog` props from `projectName` to:

```ts
interface Props {
  title: string;
  message: string;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}
```

Single-close copy remains project-specific. Multi-close copy uses the number of tabs, for example title `Close 4 tabs?` and message `This will terminate all 4 running agent sessions.`

- [ ] **Step 7: Run tests and build**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/tab-state.test.mjs`

Expected: all three tab-state tests PASS.

Run: `npm test`

Expected: all repository tests PASS.

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 8: Commit**

```powershell
git add src/renderer/store/tab-state.ts src/renderer/store/app-store.ts src/renderer/components/TerminalTabs.tsx src/renderer/components/CloseTabConfirmDialog.tsx src/renderer/styles/theme.css tests/tab-state.test.mjs
git commit -m "feat: add close actions to terminal tabs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: End-to-End Verification

**Files:**
- Verify: all files changed in Tasks 1-6

- [ ] **Step 1: Run the complete automated test suite**

Run: `npm test`

Expected: every test passes with zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: main, preload, and renderer bundles build successfully.

- [ ] **Step 3: Check formatting and accidental changes**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: no uncommitted files from the implementation.

- [ ] **Step 4: Perform manual Electron verification**

Run: `npm run dev`

Verify:

1. startup refresh happens immediately;
2. manual refresh still works;
3. a missing project shows a checkbox only after cleanup mode is activated;
4. Delete selected removes only selected missing histories;
5. Delete all deleted removes all and only missing histories;
6. cancelling confirmation changes nothing;
7. every tab context menu contains Close, Close Others, and Close All;
8. Close Others keeps the clicked tab active;
9. Close All leaves the empty state;
10. simulating unreadable Copilot event files does not collapse a previously populated Copilot group to zero.

- [ ] **Step 5: Stop the development process**

Stop only the process started in Step 4 by its recorded process ID.
