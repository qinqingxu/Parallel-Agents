/* global window, document, MouseEvent */
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { app } = require('electron');

const [home, project, reports, mainEntry, reportName] = process.argv.slice(2);
assert.ok(
  home && project && reports && mainEntry && reportName,
  'Run this fixture through npm run test:smoke',
);
const startedAt = Date.now();
const smokeTimeoutMs = 120_000;
let finished = false;
let windowUnderTest;
let initialJavaScriptBytes;

for (const name of ['userData', 'sessionData']) {
  const path = join(home, name);
  mkdirSync(path, { recursive: true });
  app.setPath(name, path);
}
app.setPath('home', home);

function finish(error, checks = []) {
  if (finished) return;
  finished = true;
  const report = {
    success: !error,
    electron: process.versions.electron,
    packaged: reportName === 'packaged-smoke',
    initialJavaScriptBytes,
    durationMs: Date.now() - startedAt,
    checks,
    error: error ? String(error.stack ?? error) : null,
  };
  writeFileSync(join(reports, `${reportName}.json`), JSON.stringify(report, null, 2) + '\n');
  if (error) console.error(error);
  else console.log(`Electron smoke passed: ${checks.join(', ')}`);
  app.exit(error ? 1 : 0);
}

process.on('uncaughtException', (error) => finish(error));
process.on('unhandledRejection', (error) => finish(error));
setTimeout(
  () => finish(new Error(`Electron smoke test exceeded ${smokeTimeoutMs / 1000} seconds`)),
  smokeTimeoutMs,
).unref();

async function checkRenderer(projectPath) {
  const checks = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const deadline = Date.now() + 10_000;
  while (!document.querySelector('#root')?.children.length) {
    if (Date.now() > deadline) throw new Error('React did not render within 10 seconds');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check(typeof window.api?.git?.diff === 'function', 'preload bridge is available');
  check(typeof window.require === 'undefined', 'renderer has no Node require');
  const projects = await window.api.projects.list();
  check(projects.length === 1 && projects[0].realPath === projectPath, 'provider data is isolated');
  const projectId = projects[0].id;
  await Promise.all([
    window.api.projects.pin(projectId, true),
    window.api.projects.hide(projectId, true),
  ]);
  const updatedProject = (await window.api.projects.list()).find((item) => item.id === projectId);
  check(
    updatedProject?.pinned && updatedProject.hidden,
    'concurrent pin and hide IPC preserve both settings',
  );
  await Promise.all([
    window.api.projects.pin(projectId, false),
    window.api.projects.hide(projectId, false),
  ]);
  await Promise.all([
    window.api.config.setTheme('light'),
    window.api.config.setConfirmOnCloseTab(false),
    window.api.config.setTerminalMultilineEnter(false),
    window.api.config.setTerminalCopyPaste(false),
  ]);
  const settings = await Promise.all([
    window.api.config.getTheme(),
    window.api.config.getConfirmOnCloseTab(),
    window.api.config.getTerminalMultilineEnter(),
    window.api.config.getTerminalCopyPaste(),
  ]);
  check(JSON.stringify(settings) === '["light",false,false,false]', 'concurrent settings persist');
  await window.api.config.setTheme('dark');

  const diff = await window.api.git.diff(projectPath, 'notes.txt', false);
  check(
    diff.oldContent === 'staged\n' && diff.newContent === 'working\n' && diff.oldLabel === 'index',
    'Git IPC compares index to working tree',
  );
  const files = await window.api.fs.readDir(projectPath);
  check(
    files.some((file) => file.name === 'notes.txt'),
    'filesystem IPC reads the fixture',
  );
  check(!files.some((file) => file.name === '.git'), 'filesystem IPC hides Git metadata');

  let output = '';
  let resolveExit;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const unsubscribeData = window.api.pty.onData((id, data) => {
    if (id === 'smoke-terminal') output += data;
  });
  const unsubscribeExit = window.api.pty.onExit((id, code) => {
    if (id === 'smoke-terminal') resolveExit(code);
  });
  let timer;
  try {
    await window.api.pty.spawn({
      projectId: 'smoke-terminal',
      cwd: projectPath,
      cols: 100,
      rows: 24,
      initialCommand: 'echo PARALLEL_AGENTS_SMOKE_OK && exit',
    });
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Native PTY did not exit within 10 seconds')),
          10_000,
        );
      }),
    ]);
    // eslint-disable-next-line no-control-regex -- PTY output contains ANSI escape sequences.
    const plainOutput = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    check(
      code === 0 &&
        plainOutput.split(/\r?\n/).some((line) => line.trim() === 'PARALLEL_AGENTS_SMOKE_OK'),
      'native PTY executes and exits successfully',
    );
  } finally {
    clearTimeout(timer);
    await window.api.pty.kill('smoke-terminal');
    unsubscribeData();
    unsubscribeExit();
  }

  const uiPtys = new Set();
  let uiOutput = '';
  const unsubscribeUi = window.api.pty.onData((id, data) => {
    uiPtys.add(id);
    uiOutput += data;
  });
  const waitFor = async (predicate, message) => {
    const until = Date.now() + 12_000;
    while (!predicate()) {
      if (Date.now() > until) throw new Error(typeof message === 'function' ? message() : message);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    let refresh;
    await waitFor(() => {
      refresh = [...document.querySelectorAll('button')].find((button) =>
        button.textContent.includes('Refresh Projects'),
      );
      return refresh && !refresh.disabled;
    }, 'The inventory refresh action is unavailable');
    refresh.click();
    await waitFor(
      () =>
        document.querySelector('.project-item') &&
        document.querySelector('.agent-group-header[title="Claude Code"]:not(.unavailable)'),
      'The isolated project and CLI did not appear',
    );
    document.querySelector('.project-item').click();
    await waitFor(() => uiOutput.includes('SMOKE_AGENT'), 'The initial inert CLI command was lost');
    checks.push('the initial CLI command reaches the mounted terminal');
    await waitFor(
      () => document.querySelectorAll('.git-row[title="notes.txt"]').length === 2,
      'Git panel did not show the fixture changes',
    );
    const rows = document.querySelectorAll('.git-row[title="notes.txt"]');
    rows[rows.length - 1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    let text = '';
    await waitFor(
      () => {
        text = document.querySelector('.monaco-diff-editor')?.textContent ?? '';
        return text.includes('staged') && text.includes('working');
      },
      () => `Offline diff revisions did not render; observed ${JSON.stringify(text.slice(0, 200))}`,
    );
    check(
      text.includes('staged') && text.includes('working'),
      'offline diff renders both revisions',
    );
    document.querySelector('.diff-close').click();
  } finally {
    unsubscribeUi();
    await Promise.all([...uiPtys].map((id) => window.api.pty.kill(id)));
  }
  return checks;
}

app.on('browser-window-created', (_event, win) => {
  if (windowUnderTest) return;
  windowUnderTest = win;
  const preferences = win.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true, 'The preload must run in the Electron sandbox');
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_request, callback) => callback({ cancel: true }),
  );
  win.webContents.once('did-fail-load', (_loadEvent, code, description) => {
    finish(new Error(`Renderer load failed (${code}): ${description}`));
  });
  win.webContents.once('render-process-gone', (_goneEvent, details) => {
    finish(new Error(`Renderer terminated: ${details.reason}`));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const checks = await win.webContents.executeJavaScript(
        `(${checkRenderer.toString()})(${JSON.stringify(project)})`,
      );
      const copilotRoot = join(home, '.copilot', 'session-state');
      mkdirSync(dirname(copilotRoot), { recursive: true });
      writeFileSync(copilotRoot, 'not a directory');
      const deleteCopilotProject = `window.api.projects.delete(${JSON.stringify(`copilot:${project}`)})`;
      console.log('Checking expected ENOTDIR rejection for isolated provider storage');
      await assert.rejects(
        win.webContents.executeJavaScript(deleteCopilotProject),
        /ENOTDIR|not a directory/i,
      );
      unlinkSync(copilotRoot);
      mkdirSync(copilotRoot);
      const controlFile = join(copilotRoot, 'metadata.json');
      writeFileSync(controlFile, '{}');
      await win.webContents.executeJavaScript(deleteCopilotProject);
      assert.equal(readFileSync(controlFile, 'utf8'), '{}');
      checks.push('project deletion surfaces storage errors and preserves non-session files');
      checks.unshift('initial entry and preload JavaScript stay below 800 KB');
      checks.unshift('sandboxed preload and context isolation are enabled');
      assert.doesNotThrow(() => app.emit('window-all-closed'));
      checks.push('tray lifecycle event is safe');
      const image = await win.capturePage();
      writeFileSync(join(reports, `${reportName}.png`), image.toPNG());
      finish(null, checks);
    } catch (error) {
      finish(error);
    }
  });
});

const rendererRoot = join(dirname(mainEntry), '..', 'renderer');
const rendererHtml = readFileSync(join(rendererRoot, 'index.html'), 'utf8');
const initialAssets = [
  ...new Set(
    [...rendererHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+\.js)"/g)].map(
      (match) => match[1],
    ),
  ),
];
assert.ok(initialAssets.length > 0, 'Expected initial renderer JavaScript assets');
initialJavaScriptBytes = initialAssets.reduce(
  (total, asset) => total + statSync(join(rendererRoot, asset)).size,
  0,
);
assert.ok(
  initialJavaScriptBytes < 800_000,
  `Initial entry and preload JavaScript exceed 800 KB: ${initialJavaScriptBytes}`,
);

require(mainEntry);
