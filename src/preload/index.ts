import { contextBridge, ipcRenderer } from 'electron';
import type { Api, UpdateStatus } from '../shared/types';

const api: Api = {
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:getStatus'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (cb) => {
      const fn = (_: unknown, status: UpdateStatus) => cb(status);
      ipcRenderer.on('updates:status', fn);
      return () => {
        ipcRenderer.off('updates:status', fn);
      };
    },
  },
  projects: {
    create: (options) => ipcRenderer.invoke('projects:create', options),
    list: () => ipcRenderer.invoke('projects:list'),
    pin: (id, pinned) => ipcRenderer.invoke('projects:pin', id, pinned),
    hide: (id, hidden) => ipcRenderer.invoke('projects:hide', id, hidden),
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    deleteMissing: (ids) => ipcRenderer.invoke('projects:deleteMissing', ids),
    setOrder: (agent, ids) => ipcRenderer.invoke('projects:setOrder', agent, ids),
  },
  sessions: {
    rename: (projectId, sessionId, title) =>
      ipcRenderer.invoke('sessions:rename', projectId, sessionId, title),
    listForProject: (projectId) => ipcRenderer.invoke('sessions:listForProject', projectId),
    delete: (projectId, sessionId) => ipcRenderer.invoke('sessions:delete', projectId, sessionId),
  },
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    write: (projectId, data) => ipcRenderer.invoke('pty:write', projectId, data),
    resize: (projectId, cols, rows) => ipcRenderer.invoke('pty:resize', projectId, cols, rows),
    kill: (projectId) => ipcRenderer.invoke('pty:kill', projectId),
    onData: (cb) => {
      const fn = (_: unknown, projectId: string, data: string) => cb(projectId, data);
      ipcRenderer.on('pty:data', fn);
      return () => ipcRenderer.off('pty:data', fn);
    },
    onExit: (cb) => {
      const fn = (_: unknown, projectId: string, code: number) => cb(projectId, code);
      ipcRenderer.on('pty:exit', fn);
      return () => ipcRenderer.off('pty:exit', fn);
    },
  },
  fs: {
    readDir: (path) => ipcRenderer.invoke('fs:readDir', path),
    createFile: (path) => ipcRenderer.invoke('fs:createFile', path),
    createDir: (path) => ipcRenderer.invoke('fs:createDir', path),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (src, dest) => ipcRenderer.invoke('fs:copy', src, dest),
    move: (src, dest) => ipcRenderer.invoke('fs:move', src, dest),
    trash: (path) => ipcRenderer.invoke('fs:trash', path),
    reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
    openDefault: (path) => ipcRenderer.invoke('fs:openDefault', path),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    checkAll: () => ipcRenderer.invoke('agents:checkAll'),
  },
  config: {
    getFontSize: () => ipcRenderer.invoke('config:getFontSize'),
    setFontSize: (size) => ipcRenderer.invoke('config:setFontSize', size),
    getFontFamily: () => ipcRenderer.invoke('config:getFontFamily'),
    setFontFamily: (fontFamily) => ipcRenderer.invoke('config:setFontFamily', fontFamily),
    getFontBold: () => ipcRenderer.invoke('config:getFontBold'),
    setFontBold: (bold) => ipcRenderer.invoke('config:setFontBold', bold),
    getLastAgent: (projectId) => ipcRenderer.invoke('config:getLastAgent', projectId),
    setLastAgent: (projectId, agentId) =>
      ipcRenderer.invoke('config:setLastAgent', projectId, agentId),
    getLayout: () => ipcRenderer.invoke('config:getLayout'),
    setLayout: (layout) => ipcRenderer.invoke('config:setLayout', layout),
    getTheme: () => ipcRenderer.invoke('config:getTheme'),
    setTheme: (theme) => ipcRenderer.invoke('config:setTheme', theme),
    getConfirmOnCloseTab: () => ipcRenderer.invoke('config:getConfirmOnCloseTab'),
    setConfirmOnCloseTab: (v) => ipcRenderer.invoke('config:setConfirmOnCloseTab', v),
    getTerminalMultilineEnter: () => ipcRenderer.invoke('config:getTerminalMultilineEnter'),
    setTerminalMultilineEnter: (v) => ipcRenderer.invoke('config:setTerminalMultilineEnter', v),
    getTerminalCopyPaste: () => ipcRenderer.invoke('config:getTerminalCopyPaste'),
    setTerminalCopyPaste: (v) => ipcRenderer.invoke('config:setTerminalCopyPaste', v),
  },
  git: {
    status: (repoPath) => ipcRenderer.invoke('git:status', repoPath),
    diff: (repoPath, filePath, staged) =>
      ipcRenderer.invoke('git:diff', repoPath, filePath, staged),
    stage: (repoPath, files) => ipcRenderer.invoke('git:stage', repoPath, files),
    unstage: (repoPath, files) => ipcRenderer.invoke('git:unstage', repoPath, files),
    discard: (repoPath, files) => ipcRenderer.invoke('git:discard', repoPath, files),
    commit: (repoPath, message) => ipcRenderer.invoke('git:commit', repoPath, message),
    watch: (repoPath) => ipcRenderer.invoke('git:watch', repoPath),
    onChanged: (cb) => {
      const fn = (_: unknown, repoPath: string) => cb(repoPath);
      ipcRenderer.on('git:changed', fn);
      return () => ipcRenderer.off('git:changed', fn);
    },
  },
  shell: {
    list: () => ipcRenderer.invoke('shell:list'),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  window: {
    onFullscreenChange: (cb) => {
      const fn = (_: unknown, on: boolean) => cb(on);
      ipcRenderer.on('window:fullscreen', fn);
      return () => ipcRenderer.off('window:fullscreen', fn);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
