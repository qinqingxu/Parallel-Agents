# Codex Project and Session Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover persisted Codex CLI sessions, group them into projects, and support listing, resuming, and deleting them through the existing UI.

**Architecture:** Add a focused `codex-storage.ts` main-process module that scans Codex rollout JSONL files and enriches them from the session index. Reuse its inventory from `projects.ts` and `sessions.ts`, keeping Codex format knowledge out of the UI and avoiding duplicate parsers.

**Tech Stack:** TypeScript, Node.js filesystem/readline APIs, Electron main process, Node test runner

---

## File Structure

- Create `src/main/codex-storage.ts`: Codex rollout discovery, metadata parsing, title lookup, path normalization, and deletion.
- Modify `src/main/projects.ts`: group Codex inventory into existing `Project` records.
- Modify `src/main/sessions.ts`: map Codex inventory to existing `Session` records and route deletion.
- Create `tests/codex-storage.test.mjs`: fixture-backed parser, grouping-input, fallback, malformed-file, and deletion tests.
- Modify `README.md`: report Codex project/session auto-detection accurately.
- Modify `ARCHITECTURE.md`: document the Codex storage root and parser.

### Task 1: Build the Codex storage adapter

**Files:**
- Create: `tests/codex-storage.test.mjs`
- Create: `src/main/codex-storage.ts`

- [ ] **Step 1: Write failing inventory tests**

Create temporary `sessions/2026/09/09/rollout-*.jsonl` fixtures with a `session_meta` record, a user `response_item`, a malformed neighboring file, and a `session_index.jsonl` entry. Assert that:

```js
const inventory = await listCodexSessions(root);
assert.equal(inventory.length, 2);
assert.equal(inventory[0].id, 'session-indexed');
assert.equal(inventory[0].title, 'Indexed title');
assert.equal(inventory[0].cwd, projectPath);
assert.equal(inventory[0].version, '0.42.0');
assert.equal(inventory[1].title, 'Fallback user prompt');
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/codex-storage.test.mjs`

Expected: FAIL because `src/main/codex-storage.ts` does not exist.

- [ ] **Step 3: Implement recursive discovery and streaming parsing**

Define:

```ts
export interface CodexStoredSession {
  id: string;
  cwd: string;
  title: string;
  timestamp: number;
  version: string | null;
  filePath: string;
}

export function normalizeCodexProjectPath(path: string): string;
export async function listCodexSessions(codexRoot?: string): Promise<CodexStoredSession[]>;
export async function deleteCodexSession(sessionId: string, codexRoot?: string): Promise<void>;
export async function deleteCodexProject(projectPath: string, codexRoot?: string): Promise<void>;
```

Use `readdir(..., { withFileTypes: true })` recursively beneath `<root>/sessions`. Stream each JSONL file with `readline`; accept `type === "session_meta"` metadata from `payload.id ?? payload.session_id`, `payload.cwd`, `payload.timestamp`, and `payload.cli_version`. Capture the first `response_item` user message `payload.content[].input_text` as a fallback title. Read `<root>/session_index.jsonl` into an ID-keyed map of `thread_name` and `updated_at`, and prefer that title and timestamp when present.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/codex-storage.test.mjs`

Expected: all Codex storage tests PASS.

- [ ] **Step 5: Commit the adapter**

```powershell
git add -- src/main/codex-storage.ts tests/codex-storage.test.mjs
git commit -m "feat: add Codex session storage adapter" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add Codex projects to inventory

**Files:**
- Modify: `src/main/projects.ts:9-12`
- Modify: `src/main/projects.ts:252-351`
- Test: `tests/codex-storage.test.mjs`

- [ ] **Step 1: Add a failing project aggregation test**

Export and test a pure grouping function:

```ts
export function groupCodexSessionsByProject(
  sessions: CodexStoredSession[],
): Array<{ realPath: string; sessionCount: number; lastActivity: number }>;
```

Assert that two sessions whose Windows paths differ only by case produce one group with `sessionCount === 2` and the newest timestamp.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/codex-storage.test.mjs`

Expected: FAIL because `groupCodexSessionsByProject` is not exported.

- [ ] **Step 3: Implement grouping and project mapping**

In `codex-storage.ts`, group by `normalizeCodexProjectPath(session.cwd)`. In `projects.ts`, add `listCodexProjects`, map each group to:

```ts
{
  id: makeProjectId('codex', group.realPath),
  agent: 'codex',
  dirName: group.realPath,
  realPath: group.realPath,
  displayName: displayNameFor(group.realPath),
  exists: await pathExists(group.realPath),
  pinned: pinned.has(id),
  hidden: hidden.has(id),
  sessionCount: group.sessionCount,
  lastActivity: group.lastActivity,
}
```

Include Codex in the existing `Promise.all` and combined sorted output. Route Codex project deletion to `deleteCodexProject(dirName)`.

- [ ] **Step 4: Run the focused test**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/codex-storage.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit project discovery**

```powershell
git add -- src/main/codex-storage.ts src/main/projects.ts tests/codex-storage.test.mjs
git commit -m "feat: discover Codex projects" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: List and delete Codex sessions

**Files:**
- Modify: `src/main/sessions.ts:12-15`
- Modify: `src/main/sessions.ts:267-358`
- Test: `tests/codex-storage.test.mjs`

- [ ] **Step 1: Add failing deletion tests**

Create two rollout files for one project and one file for another. Call `deleteCodexSession` and `deleteCodexProject`, then assert only targeted files are removed and a missing session rejects with `Session not found`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/codex-storage.test.mjs`

Expected: FAIL until deletion behavior is implemented.

- [ ] **Step 3: Wire Codex sessions into the existing API**

Add:

```ts
async function listCodexProjectSessions(projectId: string, projectPath: string): Promise<Session[]> {
  const target = normalizeCodexProjectPath(projectPath);
  return (await listCodexSessions())
    .filter((session) => normalizeCodexProjectPath(session.cwd) === target)
    .map((session) => ({
      id: session.id,
      projectId,
      agent: 'codex',
      title: session.title,
      timestamp: session.timestamp,
      cwd: session.cwd,
      gitBranch: null,
      version: session.version,
    }));
}
```

Route `agent === 'codex'` through this function in `listSessionsForProject`, and route session deletion through `deleteCodexSession(sessionId)`. The renderer already builds `codex resume <sessionId>`, so no UI change is required.

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit session integration**

```powershell
git add -- src/main/sessions.ts tests/codex-storage.test.mjs
git commit -m "feat: expose Codex sessions" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Update documentation and validate production build

**Files:**
- Modify: `README.md:45`
- Modify: `README.md:82`
- Modify: `ARCHITECTURE.md:47`
- Modify: `ARCHITECTURE.md:171-180`

- [ ] **Step 1: Correct the feature documentation**

State that the unified project list includes Codex and that Codex sessions are auto-detected from `~/.codex/sessions/`. Add Codex to the architecture storage diagram and project/session parser notes.

- [ ] **Step 2: Run whitespace validation**

Run: `git --no-pager diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Electron Vite main, preload, and renderer builds complete successfully.

- [ ] **Step 4: Verify behavior against real Codex storage**

Run a local script that calls `listCodexSessions()` with the default root and prints only session IDs, normalized working directories, and counts. Confirm at least one known Codex project and its sessions are returned without printing message content.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- README.md ARCHITECTURE.md docs/superpowers/plans/2026-09-09-codex-project-session-visibility.md
git commit -m "docs: document Codex session discovery" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
