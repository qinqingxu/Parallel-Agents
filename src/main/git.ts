import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync, statSync, watch as watchSync } from 'fs';
import type { FSWatcher } from 'fs';
import { join, resolve } from 'path';
import type { BrowserWindow } from 'electron';
import type { GitStatus, GitChange, GitFileState } from '../shared/types.ts';
import { sendToWindow } from './window-messenger.ts';

const execFileAsync = promisify(execFile);

async function git(repoPath: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', ['--no-pager', '--literal-pathspecs', '-C', repoPath, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

async function worktreeRoot(repoPath: string): Promise<string> {
  const { stdout } = await git(repoPath, ['rev-parse', '--show-toplevel']);
  const root = stdout.replace(/\r?\n$/, '');
  if (!root) throw new Error(`Git did not return a worktree root for ${repoPath}`);
  return root;
}

function hasErrorCode(error: unknown, code: string | number): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

let gitAvailable: Promise<boolean> | null = null;
export function isGitAvailable(): Promise<boolean> {
  gitAvailable ??= execFileAsync('git', ['--version'], { windowsHide: true }).then(
    () => true,
    (error: unknown) => {
      if (hasErrorCode(error, 'ENOENT')) return false;
      throw error;
    },
  );
  return gitAvailable;
}

async function isRepo(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await git(repoPath, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function decodeStatus(c: string): GitFileState | null {
  switch (c) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'renamed'; // copied — treat as renamed for UI purposes
    case '?':
      return 'untracked';
    case 'U':
      return 'conflict';
    case ' ':
      return null;
    default:
      return null;
  }
}

function parsePorcelainZ(out: string): GitChange[] {
  // Records are NUL-terminated. R/C records have an extra NUL-separated oldPath field.
  const parts = out.split('\0');
  const changes: GitChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const rec = parts[i];
    if (!rec) {
      i++;
      continue;
    }
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    const x = xy[0];
    const y = xy[1];
    let oldPath: string | undefined;
    if (x === 'R' || x === 'C') {
      oldPath = parts[i + 1];
      i += 2;
    } else {
      i += 1;
    }
    if (xy === '??') {
      changes.push({ path, staged: null, unstaged: 'untracked' });
      continue;
    }
    changes.push({
      path,
      staged: decodeStatus(x),
      unstaged: decodeStatus(y),
      oldPath,
    });
  }
  return changes;
}

async function getAheadBehind(repoPath: string): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await git(repoPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    const [behind, ahead] = stdout
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10) || 0);
    return { ahead: ahead ?? 0, behind: behind ?? 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export async function getStatus(repoPath: string): Promise<GitStatus | null> {
  if (!(await isGitAvailable())) return null;
  if (!(await isRepo(repoPath))) return null;

  const [{ stdout: branchOut }, { stdout: statusOut }, ab] = await Promise.all([
    git(repoPath, ['branch', '--show-current']),
    git(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    getAheadBehind(repoPath),
  ]);
  const branch = branchOut.trim() || '(detached)';
  const changes = parsePorcelainZ(statusOut);
  return { branch, ahead: ab.ahead, behind: ab.behind, changes };
}

async function readHeadFile(repoPath: string, filePath: string): Promise<string | null> {
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch (error) {
    if (hasErrorCode(error, 1)) return null;
    throw error;
  }
  const { stdout } = await git(repoPath, ['ls-tree', '-z', 'HEAD', '--', filePath]);
  if (!stdout) return null;
  const [metadata] = stdout.split('\t');
  const [, kind, objectId] = metadata.split(' ');
  if (kind !== 'blob') throw new Error(`Cannot show a text diff for ${filePath}: ${kind} object`);
  return (await git(repoPath, ['cat-file', 'blob', objectId])).stdout;
}

async function readIndexFile(repoPath: string, filePath: string): Promise<string | null> {
  const { stdout } = await git(repoPath, ['ls-files', '--stage', '-z', '--', filePath]);
  const records = stdout.split('\0').filter((record) => {
    const separator = record.indexOf('\t');
    return separator !== -1 && record.slice(separator + 1) === filePath;
  });
  if (!records.length) return null;
  const record = records.find((entry) => entry.slice(0, entry.indexOf('\t')).endsWith(' 0'));
  if (!record) {
    throw new Error(`Resolve the merge conflict before comparing the index for ${filePath}`);
  }
  const [, objectId] = record.slice(0, record.indexOf('\t')).split(' ');
  return (await git(repoPath, ['cat-file', 'blob', objectId])).stdout;
}

export async function getDiff(
  repoPath: string,
  filePath: string,
  staged: boolean,
): Promise<{ oldContent: string; newContent: string; oldLabel: string; newLabel: string }> {
  const root = await worktreeRoot(repoPath);
  let oldPath = filePath;
  if (staged) {
    const { stdout } = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no']);
    oldPath =
      parsePorcelainZ(stdout).find((change) => change.path === filePath)?.oldPath ?? filePath;
  }
  const oldContent = staged
    ? await readHeadFile(root, oldPath)
    : await readIndexFile(root, filePath);
  const oldLabel = oldContent === null ? '(new file)' : staged ? 'HEAD' : 'index';
  if (staged) {
    const newContent = await readIndexFile(root, filePath);
    return {
      oldContent: oldContent ?? '',
      newContent: newContent ?? '',
      oldLabel,
      newLabel: 'index',
    };
  }

  try {
    const newContent = await readFile(join(root, filePath), 'utf-8');
    return { oldContent: oldContent ?? '', newContent, oldLabel, newLabel: 'working tree' };
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
    return { oldContent: oldContent ?? '', newContent: '', oldLabel, newLabel: '(deleted)' };
  }
}

export async function stage(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const root = await worktreeRoot(repoPath);
  await git(root, ['add', '--', ...files]);
}

export async function unstage(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const root = await worktreeRoot(repoPath);
  await git(root, ['reset', 'HEAD', '--', ...files]);
}

export async function discard(repoPath: string, files: string[]): Promise<void> {
  if (!files.length) return;
  const root = await worktreeRoot(repoPath);
  await git(root, ['checkout', '--', ...files]);
}

export async function commit(repoPath: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('Empty commit message');
  await git(repoPath, ['commit', '-m', message]);
}

// --- watcher: emit 'git:changed' when .git/index or HEAD changes -----------

interface Watcher {
  repoPath: string;
  fsWatchers: FSWatcher[];
  pollTimer: NodeJS.Timeout;
  lastFire: number;
}

const watchers = new Map<string, Watcher>();
let mainWindow: BrowserWindow | null = null;

export function attachWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function detachWindow(): void {
  mainWindow = null;
}

function emitChange(repoPath: string): void {
  const w = watchers.get(repoPath);
  if (!w) return;
  // Debounce: only emit at most once per 800ms.
  const now = Date.now();
  if (now - w.lastFire < 800) return;
  w.lastFire = now;
  sendToWindow(mainWindow, 'git:changed', repoPath);
}

export function watchRepo(repoPath: string): void {
  if (watchers.has(repoPath)) return;
  let gitDir = join(repoPath, '.git');
  if (!existsSync(gitDir)) return;
  if (statSync(gitDir).isFile()) {
    const pointer = readFileSync(gitDir, 'utf-8').trim();
    if (!pointer.startsWith('gitdir: '))
      throw new Error(`Invalid Git directory pointer: ${gitDir}`);
    gitDir = resolve(repoPath, pointer.slice('gitdir: '.length));
  }

  const fsWatchers: FSWatcher[] = [];
  try {
    // Watch the directory so atomic index replacements do not orphan the watcher.
    const watcher = watchSync(gitDir, (_event, filename) => {
      if (filename === null || ['index', 'HEAD', 'packed-refs'].includes(filename.toString())) {
        emitChange(repoPath);
      }
    });
    watcher.on('error', (error) => {
      console.warn(
        `Git filesystem notifications failed for ${repoPath}; polling remains active`,
        error,
      );
    });
    fsWatchers.push(watcher);
  } catch (error) {
    console.warn(`Cannot watch Git metadata for ${repoPath}; using polling`, error);
  }
  const pollTimer = setInterval(() => emitChange(repoPath), 5000);
  watchers.set(repoPath, { repoPath, fsWatchers, pollTimer, lastFire: 0 });
}

export function unwatchRepo(repoPath: string): void {
  const w = watchers.get(repoPath);
  if (!w) return;
  for (const fw of w.fsWatchers) fw.close();
  clearInterval(w.pollTimer);
  watchers.delete(repoPath);
}

export function unwatchAll(): void {
  for (const repo of Array.from(watchers.keys())) unwatchRepo(repo);
}
