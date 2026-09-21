import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function createStore(api) {
  const result = await build({
    entryPoints: ['src/renderer/store/app-store.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'command-icons-without-images',
        setup(builder) {
          builder.onResolve({ filter: /icons\/agentIcons$/ }, () => ({
            path: 'icons',
            namespace: 'commands',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'commands' }, () => ({
            contents:
              'export const startCommandFor=id=>id; export const resumeCommandFor=(id,s)=>`${id} resume ${s}`; export const extraPathFor=()=>[];',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'document', result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
    { api },
    { documentElement: { style: { setProperty() {} } } },
  );
  return module.exports.useAppStore;
}

test('single session project opens a bound tab and renames without restarting it', async () => {
  let session = { id: 'one', projectId: 'codex:repo', agent: 'codex', title: 'Original' };
  const killed = [];
  const api = {
    sessions: {
      listForProject: async () => [session],
      rename: async (_project, _id, title) => {
        session = { ...session, title };
        return title;
      },
    },
    config: { setLastAgent: async () => {} },
    git: { status: async () => null, watch: async () => {} },
    pty: { kill: async (id) => killed.push(id) },
  };
  const store = await createStore(api);
  const project = {
    id: 'codex:repo',
    agent: 'codex',
    dirName: 'repo',
    realPath: 'C:\\repo',
    displayName: 'Repo',
    exists: true,
    sessionCount: 1,
  };
  store.setState({ projects: [project] });
  await store.getState().openProjectFromList(project.id);
  const tab = store.getState().activeTabId;
  assert.equal(store.getState().tabSessionId[tab], 'one');
  await store.getState().renameSession(project.id, 'one', 'Renamed');
  assert.equal(store.getState().sessions[project.id][0].title, 'Renamed');
  assert.equal(store.getState().activeTabId, tab);
  assert.deepEqual(killed, []);
  store.getState().closeTab(tab);
  await store.getState().openProjectFromList(project.id);
  assert.equal(store.getState().sessions[project.id][0].title, 'Renamed');
});

test('new project requires explicit session association and avoids duplicate resume', async () => {
  let sessions = [];
  const project = {
    id: 'codex:manual:repo',
    agent: 'codex',
    dirName: 'manual:repo',
    realPath: 'C:\\repo',
    displayName: 'Repo',
    exists: true,
    sessionCount: 0,
  };
  const store = await createStore({
    projects: { create: async () => project },
    sessions: { listForProject: async () => sessions },
    config: { setLastAgent: async () => {} },
  });
  await store
    .getState()
    .createProject({ agent: 'codex', mode: 'folder', basePath: project.realPath });
  assert.equal(store.getState().pendingInitialCommand[project.id].command, 'codex');
  assert.equal(store.getState().selectedProjectId, project.id);
  sessions = [{ id: 'new-session', projectId: project.id, agent: 'codex', title: 'New task' }];
  await store.getState().loadSessions(project.id);
  assert.equal(store.getState().tabSessionId[project.id], null);
  await store.getState().openSessionTab(project.id, sessions[0]);
  assert.equal(store.getState().sessionLinkRequest.sessionId, 'new-session');
  assert.equal(store.getState().openTabs.length, 1);
  store.getState().linkSession(project.id, 'new-session');
  assert.equal(store.getState().tabSessionId[project.id], 'new-session');
  assert.deepEqual(store.getState().tabSessionBaseline, {});
  await store.getState().openSessionTab(project.id, sessions[0]);
  assert.equal(store.getState().openTabs.length, 1);
});

test('external history arriving before the launched session cannot claim the terminal', async () => {
  let sessions = [];
  const store = await createStore({
    config: { setLastAgent: async () => {} },
    sessions: { listForProject: async () => sessions },
  });
  await store.getState().openTabWithAgent('codex:repo', 'codex', 'codex');
  sessions = [{ id: 'external', agent: 'codex', title: 'External' }];
  await store.getState().loadSessions('codex:repo');
  assert.equal(store.getState().tabSessionId['codex:repo'], null);
  sessions.push({ id: 'actual', agent: 'codex', title: 'Actual' });
  await store.getState().loadSessions('codex:repo');
  assert.equal(store.getState().tabSessionId['codex:repo'], null);
  store.getState().linkSession('codex:repo', 'actual');
  assert.equal(store.getState().tabSessionId['codex:repo'], 'actual');
});

test('concurrently opening sessions preserves both tabs and deduplicates the same session', async () => {
  const store = await createStore({
    config: { setLastAgent: async () => {} },
  });
  const session = { id: 'first', agent: 'codex', projectId: 'codex:repo', title: 'First' };
  await Promise.all([
    store.getState().openSessionTab(session.projectId, session),
    store.getState().openSessionTab(session.projectId, { ...session, id: 'second' }),
    store.getState().openSessionTab(session.projectId, session),
  ]);
  assert.equal(store.getState().openTabs.length, 2);
  assert.deepEqual(Object.values(store.getState().tabSessionId), ['first', 'second']);
  await store.getState().openSessionTab('codex:another-project', session);
  assert.equal(store.getState().openTabs.length, 2);
});
