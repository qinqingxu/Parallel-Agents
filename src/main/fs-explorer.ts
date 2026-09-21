import { readdir, stat, writeFile, rename as fsRename, cp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { shell } from 'electron';
import type { FsNode } from '../shared/types.ts';

const IGNORE = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'out', '.cache']);

export async function readDir(path: string): Promise<FsNode[]> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch {
    return [];
  }

  const out: FsNode[] = [];
  for (const name of entries) {
    if (IGNORE.has(name)) continue;
    const full = join(path, name);
    let isDir: boolean;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }
    out.push({ name, path: full, isDirectory: isDir });
  }

  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function createFile(path: string): Promise<void> {
  if (await exists(path)) throw new Error(`Already exists: ${path}`);
  await writeFile(path, '', { flag: 'wx' });
}

export async function createDir(path: string): Promise<void> {
  if (await exists(path)) throw new Error(`Already exists: ${path}`);
  await mkdir(path, { recursive: false });
}

export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return;
  if (await exists(newPath)) throw new Error(`Target exists: ${newPath}`);
  await fsRename(oldPath, newPath);
}

export async function copyPath(srcPath: string, destPath: string): Promise<void> {
  if (await exists(destPath)) throw new Error(`Target exists: ${destPath}`);
  await cp(srcPath, destPath, { recursive: true, errorOnExist: true, force: false });
}

export async function movePath(srcPath: string, destPath: string): Promise<void> {
  if (await exists(destPath)) throw new Error(`Target exists: ${destPath}`);
  try {
    await fsRename(srcPath, destPath);
  } catch (err) {
    // EXDEV: cross-device link not permitted — fall back to copy + remove
    if (!(err instanceof Error) || !('code' in err) || err.code !== 'EXDEV') throw err;
    await cp(srcPath, destPath, { recursive: true, errorOnExist: true, force: false });
    await rm(srcPath, { recursive: true, force: true });
  }
}

export async function trashPath(path: string): Promise<void> {
  await shell.trashItem(path);
}

export async function revealInExplorer(path: string): Promise<void> {
  shell.showItemInFolder(path);
}

export async function openWithDefault(path: string): Promise<void> {
  const err = await shell.openPath(path);
  if (err) throw new Error(err);
}
