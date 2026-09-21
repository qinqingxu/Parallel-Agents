import type { SessionShellProfile } from './session-terminals';

export type AgentId = 'claude' | 'codex' | 'gemini' | 'aider' | 'copilot';

export interface AgentInfo {
  id: AgentId;
  displayName: string;
  iconAsset: string;
  installHint: string;
  installUrl: string;
  hasResume: boolean;
}

export interface AgentStatus {
  available: boolean;
  path: string | null;
}

export interface Project {
  id: string;
  agent: AgentId;
  dirName: string;
  realPath: string;
  displayName: string;
  exists: boolean;
  pinned: boolean;
  hidden: boolean;
  sessionCount: number;
  lastActivity: number | null;
  historyProjectId?: string;
}

export interface RegisteredProject {
  id: string;
  agent: AgentId;
  realPath: string;
  historyPath?: string;
}

export interface NewProjectOptions {
  agent: AgentId;
  basePath: string;
  mode: 'folder' | 'worktree';
  branch?: string;
  startPoint?: string;
  targetPath?: string;
}

export interface AvailableShell {
  id: string;
  label: string;
  command: string;
  args: string[];
}

export interface Session {
  id: string;
  projectId: string;
  agent: AgentId;
  title: string;
  timestamp: number;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
}

export interface FsNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FsNode[];
}

export interface PtySpawnOptions {
  projectId: string;
  cwd: string;
  cols: number;
  rows: number;
  initialCommand?: string;
  extraPath?: string[];
  shellProfile?: SessionShellProfile;
}

export type PaneId = 'sidebar' | 'middle' | 'right';

export interface LayoutConfig {
  order: [PaneId, PaneId, PaneId];
  sizes: [number, number, number];
}

export type ThemeMode = 'dark' | 'light';

export interface AppConfig {
  pinned: string[];
  hidden: string[];
  lastAgentByProject: Record<string, AgentId>;
  projectOrder: Record<AgentId, string[]>;
  layout: LayoutConfig;
  theme: ThemeMode;
  confirmOnCloseTab: boolean;
  terminalMultilineEnter: boolean;
  terminalCopyPaste: boolean;
}

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface GitChange {
  path: string;
  staged: GitFileState | null;
  unstaged: GitFileState | null;
  oldPath?: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
}

export interface GitDiff {
  oldContent: string;
  newContent: string;
  oldLabel: string;
  newLabel: string;
}

export interface UpdateStatus {
  state:
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  canInstall: boolean;
}

export interface Api {
  updates: {
    getStatus(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<UpdateStatus>;
    onStatus(cb: (status: UpdateStatus) => void): () => void;
  };
  projects: {
    create(options: NewProjectOptions): Promise<Project>;
    list(): Promise<Project[]>;
    pin(id: string, pinned: boolean): Promise<void>;
    hide(id: string, hidden: boolean): Promise<void>;
    delete(id: string): Promise<void>;
    deleteMissing(ids: string[]): Promise<void>;
    setOrder(agent: AgentId, ids: string[]): Promise<void>;
  };
  sessions: {
    rename(projectId: string, sessionId: string, title: string): Promise<string>;
    listForProject(projectId: string): Promise<Session[]>;
    delete(projectId: string, sessionId: string): Promise<void>;
  };
  pty: {
    spawn(opts: PtySpawnOptions): Promise<void>;
    write(projectId: string, data: string): Promise<void>;
    resize(projectId: string, cols: number, rows: number): Promise<void>;
    kill(projectId: string): Promise<void>;
    onData(cb: (projectId: string, data: string) => void): () => void;
    onExit(cb: (projectId: string, code: number) => void): () => void;
  };
  fs: {
    readDir(path: string): Promise<FsNode[]>;
    createFile(path: string): Promise<void>;
    createDir(path: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copy(srcPath: string, destPath: string): Promise<void>;
    move(srcPath: string, destPath: string): Promise<void>;
    trash(path: string): Promise<void>;
    reveal(path: string): Promise<void>;
    openDefault(path: string): Promise<void>;
  };
  dialog: {
    pickDirectory(): Promise<string | null>;
  };
  agents: {
    list(): Promise<AgentInfo[]>;
    checkAll(): Promise<Record<AgentId, AgentStatus>>;
  };
  config: {
    getFontSize(): Promise<number>;
    setFontSize(size: number): Promise<void>;
    getFontFamily(): Promise<string>;
    setFontFamily(fontFamily: string): Promise<void>;
    getFontBold(): Promise<boolean>;
    setFontBold(bold: boolean): Promise<void>;
    getLastAgent(projectId: string): Promise<AgentId | null>;
    setLastAgent(projectId: string, agentId: AgentId): Promise<void>;
    getLayout(): Promise<LayoutConfig>;
    setLayout(layout: LayoutConfig): Promise<void>;
    getTheme(): Promise<ThemeMode>;
    setTheme(theme: ThemeMode): Promise<void>;
    getConfirmOnCloseTab(): Promise<boolean>;
    setConfirmOnCloseTab(v: boolean): Promise<void>;
    getTerminalMultilineEnter(): Promise<boolean>;
    setTerminalMultilineEnter(v: boolean): Promise<void>;
    getTerminalCopyPaste(): Promise<boolean>;
    setTerminalCopyPaste(v: boolean): Promise<void>;
  };
  git: {
    status(repoPath: string): Promise<GitStatus | null>;
    diff(repoPath: string, filePath: string, staged: boolean): Promise<GitDiff>;
    stage(repoPath: string, files: string[]): Promise<void>;
    unstage(repoPath: string, files: string[]): Promise<void>;
    discard(repoPath: string, files: string[]): Promise<void>;
    commit(repoPath: string, message: string): Promise<void>;
    watch(repoPath: string): Promise<void>;
    onChanged(cb: (repoPath: string) => void): () => void;
  };
  shell: {
    list(): Promise<AvailableShell[]>;
    openExternal(url: string): Promise<void>;
  };
  window: {
    onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
