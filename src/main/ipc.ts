import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { listProjects, deleteProject, deleteMissingProjects, createProject } from './projects.ts';
import { listSessionsForProject, deleteSession, renameSession } from './sessions.ts';
import {
  readDir,
  createFile,
  createDir,
  renamePath,
  copyPath,
  movePath,
  trashPath,
  revealInExplorer,
  openWithDefault,
} from './fs-explorer.ts';
import {
  setProjectPinned,
  setProjectHidden,
  setLastAgent,
  getLastAgent,
  setProjectOrder,
  getLayout,
  setLayout,
  getTheme,
  setTheme,
  getConfirmOnCloseTab,
  setConfirmOnCloseTab,
  getTerminalMultilineEnter,
  setTerminalMultilineEnter,
  getTerminalCopyPaste,
  setTerminalCopyPaste,
} from './config.ts';
import { ptyManager } from './pty-manager.ts';
import { checkAllAgents, listAgents } from './agent-providers.ts';
import * as git from './git.ts';
import type {
  AgentId,
  LayoutConfig,
  ThemeMode,
  NewProjectOptions,
  PtySpawnOptions,
} from '../shared/types.ts';
import { preferences } from './preferences-store.ts';
import { discoverShells } from './shell-profiles.ts';
import type { UpdateController } from './update-controller.ts';

export function registerIpc(win: BrowserWindow, updates: UpdateController) {
  ptyManager.attachWindow(win);
  git.attachWindow(win);

  ipcMain.handle('updates:getStatus', () => updates.getStatus());
  ipcMain.handle('updates:check', () => updates.check());
  ipcMain.handle('updates:install', () => updates.install());
  const unsubscribeUpdates = updates.subscribe((status) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('updates:status', status);
    }
  });
  win.once('closed', () => {
    unsubscribeUpdates();
    for (const channel of ['updates:getStatus', 'updates:check', 'updates:install'])
      ipcMain.removeHandler(channel);
  });

  ipcMain.handle('projects:list', () => listProjects());
  ipcMain.handle('projects:create', (_e, options: NewProjectOptions) => createProject(options));

  ipcMain.handle('projects:pin', (_e, id: string, pinned: boolean) => setProjectPinned(id, pinned));

  ipcMain.handle('projects:hide', (_e, id: string, hidden: boolean) =>
    setProjectHidden(id, hidden),
  );

  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));
  ipcMain.handle('projects:deleteMissing', (_e, ids: string[]) => deleteMissingProjects(ids));
  ipcMain.handle('projects:setOrder', (_e, agent: AgentId, ids: string[]) =>
    setProjectOrder(agent, ids),
  );

  ipcMain.handle('sessions:listForProject', (_e, projectId: string) =>
    listSessionsForProject(projectId),
  );
  ipcMain.handle('sessions:delete', (_e, projectId: string, sessionId: string) =>
    deleteSession(projectId, sessionId),
  );
  ipcMain.handle('sessions:rename', (_e, projectId: string, sessionId: string, title: string) =>
    renameSession(projectId, sessionId, title),
  );

  ipcMain.handle('fs:readDir', (_e, path: string) => readDir(path));
  ipcMain.handle('fs:createFile', (_e, path: string) => createFile(path));
  ipcMain.handle('fs:createDir', (_e, path: string) => createDir(path));
  ipcMain.handle('fs:rename', (_e, oldPath: string, newPath: string) =>
    renamePath(oldPath, newPath),
  );
  ipcMain.handle('fs:copy', (_e, src: string, dest: string) => copyPath(src, dest));
  ipcMain.handle('fs:move', (_e, src: string, dest: string) => movePath(src, dest));
  ipcMain.handle('fs:trash', (_e, path: string) => trashPath(path));
  ipcMain.handle('fs:reveal', (_e, path: string) => revealInExplorer(path));
  ipcMain.handle('fs:openDefault', (_e, path: string) => openWithDefault(path));

  ipcMain.handle('pty:spawn', (_e, opts: PtySpawnOptions) => {
    return ptyManager.spawn(
      opts.projectId,
      opts.cwd,
      opts.cols,
      opts.rows,
      opts.initialCommand,
      opts.extraPath,
      opts.shellProfile,
    );
  });
  ipcMain.handle('pty:write', (_e, projectId: string, data: string) => {
    ptyManager.write(projectId, data);
  });
  ipcMain.handle('pty:resize', (_e, projectId: string, cols: number, rows: number) => {
    ptyManager.resize(projectId, cols, rows);
  });
  ipcMain.handle('pty:kill', (_e, projectId: string) => {
    ptyManager.kill(projectId);
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Project Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('agents:list', () => listAgents());
  ipcMain.handle('agents:checkAll', () => checkAllAgents());

  ipcMain.handle('config:getLastAgent', (_e, projectId: string) => getLastAgent(projectId));
  ipcMain.handle('config:setLastAgent', (_e, projectId: string, agentId: AgentId) =>
    setLastAgent(projectId, agentId),
  );
  ipcMain.handle('config:getLayout', () => getLayout());
  ipcMain.handle('config:setLayout', (_e, layout: LayoutConfig) => setLayout(layout));
  ipcMain.handle('config:getTheme', () => getTheme());
  ipcMain.handle('config:setTheme', (_e, theme: ThemeMode) => setTheme(theme));
  ipcMain.handle('config:getConfirmOnCloseTab', () => getConfirmOnCloseTab());
  ipcMain.handle('config:setConfirmOnCloseTab', (_e, v: boolean) => setConfirmOnCloseTab(v));
  ipcMain.handle('config:getTerminalMultilineEnter', () => getTerminalMultilineEnter());
  ipcMain.handle('config:setTerminalMultilineEnter', (_e, v: boolean) =>
    setTerminalMultilineEnter(v),
  );
  ipcMain.handle('config:getTerminalCopyPaste', () => getTerminalCopyPaste());
  ipcMain.handle('config:setTerminalCopyPaste', (_e, v: boolean) => setTerminalCopyPaste(v));
  ipcMain.handle('config:getFontSize', async () => (await preferences.read()).fontSize);
  ipcMain.handle('config:setFontSize', (_e, size: number) => preferences.setFontSize(size));
  ipcMain.handle('config:getFontBold', async () => (await preferences.read()).fontBold);
  ipcMain.handle('config:setFontBold', (_e, bold: boolean) => preferences.setFontBold(bold));
  ipcMain.handle('shell:list', () => discoverShells());

  ipcMain.handle('git:status', (_e, repoPath: string) => git.getStatus(repoPath));
  ipcMain.handle('git:diff', (_e, repoPath: string, filePath: string, staged: boolean) =>
    git.getDiff(repoPath, filePath, staged),
  );
  ipcMain.handle('git:stage', (_e, repoPath: string, files: string[]) =>
    git.stage(repoPath, files),
  );
  ipcMain.handle('git:unstage', (_e, repoPath: string, files: string[]) =>
    git.unstage(repoPath, files),
  );
  ipcMain.handle('git:discard', (_e, repoPath: string, files: string[]) =>
    git.discard(repoPath, files),
  );
  ipcMain.handle('git:commit', (_e, repoPath: string, message: string) =>
    git.commit(repoPath, message),
  );
  ipcMain.handle('git:watch', (_e, repoPath: string) => git.watchRepo(repoPath));

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url);
  });
}
